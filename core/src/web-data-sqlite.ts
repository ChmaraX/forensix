import { lstat, mkdtemp, open, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { ForensixError, WorkingCopyIntegrityRefusal } from "./errors.js";
import type { CommitState } from "./forensic-model.js";
import { openDatabaseSync } from "./sqlite-open.js";
import { readStableRegularFile } from "./stable-file.js";

export type RawWebDataValue = null | string | bigint | Uint8Array;

/**
 * One row of the Chrome `autofill` table, preserved column-by-column exactly as
 * stored. The `autofill` table has no integer primary key — its logical key is
 * `(name, value)` — so the stable SQLite `rowid` is retained as the Provenance
 * row identity. Values keep their raw SQLite type so the Finding layer can
 * classify each Field State (value, absent, or unavailable) without lossy
 * coercion.
 */
export interface RawAutofillRow {
  readonly values: ReadonlyMap<string, RawWebDataValue>;
  readonly rowId: bigint | null;
}

export interface WebDataSchema {
  readonly version: number;
  readonly columns: ReadonlySet<string>;
}

export interface WebDataPass {
  readonly schema: WebDataSchema;
  readonly rows: readonly RawAutofillRow[];
  readonly integrity: string;
}

export interface RecoveredWebDataPass extends WebDataPass {
  readonly commitState: Exclude<CommitState, "committed">;
}

export interface WebDataPasses {
  readonly committed: WebDataPass;
  readonly recovered: RecoveredWebDataPass | null;
  readonly recoveryUnavailableReason: string | null;
}

export interface VerifiedWebDataFile {
  readonly path: string;
  readonly manifestPath: string;
  readonly size: number;
  readonly sha256: string;
}

/**
 * Columns the metadata pipeline preserves when present. The `name` column holds
 * the form field type (for example `email`, `phone`, `city`, or a structured
 * address component such as `ADDRESS_HOME_CITY`), which is how the `autofill`
 * table captures form/phone/address/city evidence. All values are cleartext, so
 * no decryption is involved.
 */
export const SUPPORTED_AUTOFILL_COLUMNS = [
  "name",
  "value",
  "value_lower",
  "date_created",
  "date_last_used",
  "count",
] as const;

const REQUIRED_AUTOFILL_COLUMNS = ["name", "value"] as const;

function tableExists(database: DatabaseSync, table: string): boolean {
  return (
    database
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1",
      )
      .get(table) !== undefined
  );
}

function tableColumns(database: DatabaseSync, table: string): Set<string> {
  return new Set(
    database
      .prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid")
      .all(table)
      .map((row) => String(row.name)),
  );
}

function readSchema(database: DatabaseSync): WebDataSchema {
  for (const table of ["meta", "autofill"]) {
    if (!tableExists(database, table)) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        `Web Data database is missing the ${table} table.`,
        { table },
      );
    }
  }

  const versionRow = database
    .prepare("SELECT value FROM meta WHERE key = 'version' LIMIT 1")
    .get();
  const versionText = versionRow?.value;
  const version =
    typeof versionText === "string" || typeof versionText === "bigint"
      ? Number(versionText)
      : Number.NaN;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      "Web Data meta.version is missing or unsupported.",
      { recorded_version: versionText ?? null },
    );
  }

  const columns = tableColumns(database, "autofill");
  const missing = REQUIRED_AUTOFILL_COLUMNS.filter(
    (column) => !columns.has(column),
  );
  if (missing.length > 0) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      `Web Data schema version ${version} is missing required autofill columns.`,
      { version, missing_columns: missing },
    );
  }

  return { version, columns };
}

function normalizeValue(value: unknown): RawWebDataValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  throw new ForensixError(
    "ANALYSIS_FAILED",
    "Web Data contains a value that cannot be preserved exactly.",
  );
}

function readPass(database: DatabaseSync): WebDataPass {
  const schema = readSchema(database);
  const selected = SUPPORTED_AUTOFILL_COLUMNS.filter((column) =>
    schema.columns.has(column),
  );
  const projection = selected
    .map((column) => `a."${column}" AS "${column}"`)
    .join(",\n      ");
  const statement = database.prepare(`
    SELECT
      a.rowid AS "__rowid",
      ${projection}
    FROM autofill a
    ORDER BY a.rowid
  `);
  const rows: RawAutofillRow[] = [];
  for (const row of statement.iterate()) {
    const values = new Map<string, RawWebDataValue>();
    for (const column of selected) {
      values.set(column, normalizeValue(row[column]));
    }
    const rawRowId = normalizeValue(row.__rowid);
    rows.push({
      values,
      rowId: typeof rawRowId === "bigint" ? rawRowId : null,
    });
  }

  const integrityRow = database.prepare("PRAGMA integrity_check(1)").get();
  const integrity = String(integrityRow?.integrity_check ?? "unavailable");
  return { schema, rows, integrity };
}

function immutableDatabase(path: string): DatabaseSync {
  const url = pathToFileURL(path);
  url.searchParams.set("immutable", "1");
  return openDatabaseSync(url.href, {
    readOnly: true,
    readBigInts: true,
  });
}

function fingerprint(row: RawAutofillRow): string {
  return JSON.stringify(
    [...row.values.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
    (_key, value: unknown) => {
      if (typeof value === "bigint") {
        return `${value.toString()}n`;
      }
      if (value instanceof Uint8Array) {
        return `blob:${Buffer.from(value).toString("base64")}`;
      }
      return value;
    },
  );
}

/**
 * Return only rows that a WAL or rollback journal adds or changes relative to
 * the committed database, keyed by `autofill.rowid`. This keeps recovered
 * evidence separate from committed evidence, mirroring the History recovery
 * contract.
 */
function recoveredOnlyRows(
  committed: readonly RawAutofillRow[],
  recovered: readonly RawAutofillRow[],
): RawAutofillRow[] {
  const committedByRowId = new Map(
    committed.flatMap((row) =>
      row.rowId === null
        ? []
        : [[row.rowId.toString(), fingerprint(row)] as const],
    ),
  );
  const rows: RawAutofillRow[] = [];
  for (const row of recovered) {
    const id = row.rowId === null ? null : row.rowId.toString();
    const committedFingerprint =
      id === null ? undefined : committedByRowId.get(id);
    if (
      committedFingerprint === undefined ||
      committedFingerprint !== fingerprint(row)
    ) {
      rows.push(row);
    }
  }
  return rows;
}

async function writeAll(destination: FileHandle, chunk: Buffer): Promise<void> {
  let written = 0;
  while (written < chunk.length) {
    const result = await destination.write(
      chunk,
      written,
      chunk.length - written,
    );
    written += result.bytesWritten;
  }
}

async function snapshotVerifiedFile(
  source: VerifiedWebDataFile,
  destinationPath: string,
): Promise<void> {
  let stats;
  try {
    stats = await lstat(source.path, { bigint: true });
  } catch {
    throw new WorkingCopyIntegrityRefusal([
      { path: source.manifestPath, reason: "entry_missing" },
    ]);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new WorkingCopyIntegrityRefusal([
      { path: source.manifestPath, reason: "entry_not_regular_file" },
    ]);
  }

  const destination = await open(destinationPath, "wx", 0o600);
  let result;
  try {
    result = await readStableRegularFile(source.path, stats, async (chunk) =>
      writeAll(destination, chunk),
    );
    await destination.sync();
  } finally {
    await destination.close();
  }
  if (result.status !== "stable") {
    throw new WorkingCopyIntegrityRefusal([
      { path: source.manifestPath, reason: "entry_unreadable" },
    ]);
  }
  const issues = [];
  if (result.size !== source.size) {
    issues.push({
      path: source.manifestPath,
      reason: "entry_size_mismatch" as const,
      expected: source.size,
      actual: result.size,
    });
  }
  if (result.sha256 !== source.sha256) {
    issues.push({
      path: source.manifestPath,
      reason: "entry_hash_mismatch" as const,
      expected: source.sha256,
      actual: result.sha256,
    });
  }
  if (issues.length > 0) {
    throw new WorkingCopyIntegrityRefusal(issues);
  }
}

export async function readWebDataPasses(options: {
  readonly database: VerifiedWebDataFile;
  readonly sidecars: readonly VerifiedWebDataFile[];
}): Promise<WebDataPasses> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "forensix-web-data-snapshot-"),
  );
  const temporaryDatabasePath = join(
    temporaryDirectory,
    basename(options.database.path),
  );
  try {
    await snapshotVerifiedFile(options.database, temporaryDatabasePath);
    for (const sidecar of options.sidecars) {
      await snapshotVerifiedFile(
        sidecar,
        join(temporaryDirectory, basename(sidecar.path)),
      );
    }

    const committedDatabase = immutableDatabase(temporaryDatabasePath);
    let committed: WebDataPass;
    try {
      committed = readPass(committedDatabase);
    } finally {
      committedDatabase.close();
    }

    const wal = options.sidecars.find((sidecar) =>
      sidecar.path.endsWith("-wal"),
    );
    const journal = options.sidecars.find((sidecar) =>
      sidecar.path.endsWith("-journal"),
    );
    const commitState =
      wal === undefined
        ? journal === undefined
          ? null
          : "journal_resident"
        : "wal_resident";
    if (commitState === null) {
      return {
        committed,
        recovered: null,
        recoveryUnavailableReason: "sidecar_not_supplied",
      };
    }

    let recoveryDatabase: DatabaseSync;
    try {
      recoveryDatabase = openDatabaseSync(temporaryDatabasePath, {
        readBigInts: true,
      });
    } catch (error) {
      return {
        committed,
        recovered: null,
        recoveryUnavailableReason: `recovery_open_failed:${String(error)}`,
      };
    }
    try {
      const fullRecoveryPass = readPass(recoveryDatabase);
      return {
        committed,
        recovered: {
          ...fullRecoveryPass,
          rows: recoveredOnlyRows(committed.rows, fullRecoveryPass.rows),
          commitState,
        },
        recoveryUnavailableReason: null,
      };
    } catch (error) {
      return {
        committed,
        recovered: null,
        recoveryUnavailableReason: `recovery_read_failed:${String(error)}`,
      };
    } finally {
      recoveryDatabase.close();
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
