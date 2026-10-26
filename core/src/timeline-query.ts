import { openCaseReadOnly } from "./case.js";
import { readCaseId } from "./case-overview.js";
import { ForensixError } from "./errors.js";
import type { CommitState, Finding } from "./forensic-model.js";
import {
  activeArtifactResultIds,
  cursorRowId,
  decodeCursor,
  encodeCursor,
  normalizeInstant,
  normalizeLimit,
  parseOption,
  QUERY_DIRECTIONS,
  queryFingerprint,
  resolveCommitState,
  resolveProfiles,
  resolveSearch,
  type QueryDirection,
} from "./finding-query.js";
import {
  decodeFinding,
  recordStore,
  storedRecordColumns,
  type Identified,
  type RecordStoreKey,
  type StoredRecordRow,
} from "./record-store.js";
import { tableExists } from "./sqlite-artifact.js";

export interface TimelineQuery {
  readonly caseDirectory: string;
  readonly limit?: number;
  readonly after?: string;
  readonly from?: string;
  readonly to?: string;
  readonly direction?: QueryDirection;
  /** Only Findings of these Profiles. */
  readonly profiles?: readonly string[];
  /** Only these Finding kinds (see {@link TIMELINE_KINDS}). */
  readonly kinds?: readonly string[];
  /** Case-insensitive substring over each Finding's search text. */
  readonly search?: string;
  readonly commitState?: CommitState;
}

/**
 * The timestamped Finding kinds: one per store, with the column that holds
 * its recorded instant. The Timeline merges them and the summary time span
 * reads them.
 */
export const TIMELINE_SOURCES = [
  { store: "history", kind: "history_visit", column: "sort_time" },
  { store: "downloads", kind: "download", column: "sort_start" },
  { store: "cookies", kind: "cookie", column: "sort_creation" },
  { store: "web-data", kind: "autofill_entry", column: "sort_last_used" },
] as const satisfies readonly {
  readonly store: RecordStoreKey;
  readonly kind: string;
  readonly column: string;
}[];

/** The Finding kinds the Timeline merges, one per timestamped table. */
export const TIMELINE_KINDS: readonly string[] = TIMELINE_SOURCES.map(
  (source) => source.kind,
);

export interface TimelinePage {
  readonly status: "ok";
  readonly command: "timeline";
  readonly items: readonly Identified<Finding>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

interface QueryRow extends StoredRecordRow {
  readonly store: RecordStoreKey;
  readonly cursor_key: string;
}

/** Merges only recorded timestamps; it does not infer events or alter Findings. */
export function queryTimeline(input: TimelineQuery): TimelinePage {
  const direction =
    parseOption(input.direction, "--direction", QUERY_DIRECTIONS) ?? "desc";
  const limit = normalizeLimit(input.limit, "Timeline");
  const from = normalizeInstant(input.from, "--from", "Timeline");
  const to = normalizeInstant(input.to, "--to", "Timeline");
  if (from !== null && to !== null && from > to)
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Timeline --from must not be later than --to.",
    );
  const profiles = resolveProfiles(input.profiles, "Timeline");
  const kinds = [...new Set(input.kinds ?? [])].sort();
  for (const kind of kinds) {
    if (!TIMELINE_KINDS.includes(kind)) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "Timeline --kind has an unsupported value.",
        { value: kind, allowed: TIMELINE_KINDS },
      );
    }
  }
  const search = resolveSearch(input.search);
  const commitState = resolveCommitState(input.commitState);

  const database = openCaseReadOnly(input.caseDirectory, { readBigInts: true });
  try {
    const stores = TIMELINE_SOURCES.map((source) => ({
      ...source,
      store: recordStore(source.store),
    }));
    if (stores.some(({ store }) => !tableExists(database, store.table))) {
      throw new ForensixError(
        "ANALYSIS_NOT_FOUND",
        "Case has no Timeline analysis. Run analyse first.",
      );
    }
    const fingerprint = queryFingerprint({
      caseId: readCaseId(database),
      activeArtifactResultIds: stores.map(({ store }) =>
        activeArtifactResultIds(database, store.resultsTable),
      ),
      from,
      to,
      direction,
      profiles,
      kinds,
      search,
      commitState,
    });
    const cursor =
      input.after === undefined
        ? null
        : decodeCursor(input.after, fingerprint, "Timeline", [
            "key",
            "id",
            "kind",
          ]);
    const branches = stores.map(
      ({ store, kind, column }) =>
        `SELECT '${store.key}' AS store, ${storedRecordColumns(store)}, f.search_text, f.${column} AS cursor_key FROM ${store.table} f JOIN ${store.resultsTable} r ON r.artifact_result_id = f.artifact_result_id WHERE r.active = 1 AND f.finding_kind = '${kind}' AND f.${column} IS NOT NULL`,
    );
    const conditions: string[] = [];
    const parameters: (string | bigint)[] = [];
    if (from !== null) {
      conditions.push("cursor_key >= ?");
      parameters.push(from);
    }
    if (to !== null) {
      conditions.push("cursor_key <= ?");
      parameters.push(to);
    }
    if (profiles.length > 0) {
      conditions.push(
        `profile_path IN (${profiles.map(() => "?").join(", ")})`,
      );
      parameters.push(...profiles);
    }
    if (kinds.length > 0) {
      conditions.push(`kind IN (${kinds.map(() => "?").join(", ")})`);
      parameters.push(...kinds);
    }
    if (search !== null) {
      conditions.push("instr(search_text, ?) > 0");
      parameters.push(search);
    }
    if (commitState !== null) {
      conditions.push("commit_state = ?");
      parameters.push(commitState);
    }
    const order = direction === "asc" ? "ASC" : "DESC";
    if (cursor !== null) {
      const operator = direction === "asc" ? ">" : "<";
      conditions.push(
        `(cursor_key ${operator} ? OR (cursor_key = ? AND (kind ${operator} ? OR (kind = ? AND row_id ${operator} ?))))`,
      );
      parameters.push(
        cursor.key,
        cursor.key,
        cursor.kind,
        cursor.kind,
        cursorRowId(cursor.id, "Timeline"),
      );
    }
    parameters.push(BigInt(limit + 1));
    const rows = database
      .prepare(
        `SELECT * FROM (${branches.join(" UNION ALL ")}) WHERE ${conditions.length === 0 ? "1 = 1" : conditions.join(" AND ")} ORDER BY cursor_key ${order}, kind ${order}, row_id ${order} LIMIT ?`,
      )
      .all(...parameters) as unknown as QueryRow[];
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      status: "ok",
      command: "timeline",
      items: pageRows.map((row) => decodeFinding(recordStore(row.store), row)),
      nextCursor:
        hasNext && last !== undefined
          ? encodeCursor(fingerprint, {
              key: last.cursor_key,
              id: last.row_id.toString(),
              kind: last.kind,
            })
          : null,
      limit,
    };
  } finally {
    database.close();
  }
}
