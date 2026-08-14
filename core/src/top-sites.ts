import { join } from "node:path";

import type {
  PersistedTopSiteFinding,
  TopSitesArtifactWrite,
} from "./case-findings.js";
import type { CaseSourceRecord } from "./case.js";
import { ForensixError, WorkingCopyIntegrityRefusal } from "./errors.js";
import {
  absentField,
  createFinding,
  unavailableField,
  valueField,
  type CommitState,
  type FieldState,
  type Finding,
  type Provenance,
} from "./forensic-model.js";
import {
  readTopSitePasses,
  type RawTopSite,
  type RawTopSiteValue,
  type TopSiteSchema,
  type VerifiedTopSiteFile,
} from "./top-sites-sqlite.js";

interface ManifestIdentity {
  readonly sourceId: string;
  readonly ordinal: number;
  readonly path: string;
  readonly databasePath: string;
}

interface BuiltTopSite {
  readonly persisted: PersistedTopSiteFinding;
}

function preservedString(
  value: RawTopSiteValue,
  columnPresent: boolean,
): FieldState<string> {
  if (!columnPresent || value === null) {
    return absentField();
  }
  return typeof value === "string"
    ? valueField(value)
    : unavailableField("unsupported_value");
}

function preservedInteger(
  value: RawTopSiteValue,
  columnPresent: boolean,
): FieldState<string> {
  if (!columnPresent || value === null) {
    return absentField();
  }
  return typeof value === "bigint"
    ? valueField(value.toString())
    : unavailableField("unsupported_value");
}

function buildTopSites(options: {
  readonly rows: readonly RawTopSite[];
  readonly schema: TopSiteSchema;
  readonly commitState: CommitState;
  readonly profile: string;
  readonly manifest: ManifestIdentity;
}): BuiltTopSite[] {
  const columns = options.schema.columns;
  return options.rows.map((row) => {
    const rowId =
      typeof row.rowId === "bigint" ? row.rowId.toString() : undefined;
    if (rowId === undefined) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Top Sites rowid is not an exact integer.",
      );
    }
    const provenance: Provenance = {
      manifestEntryId: `${options.manifest.sourceId}:${options.manifest.ordinal}`,
      sourceId: options.manifest.sourceId,
      manifestEntryOrdinal: options.manifest.ordinal,
      manifestPath: options.manifest.path,
      database: options.manifest.databasePath,
      table: "top_sites",
      rowId,
    };

    const url = preservedString(row.url, columns.has("url"));
    const title = preservedString(row.title, columns.has("title"));
    const urlRank = preservedInteger(row.urlRank, columns.has("url_rank"));

    const fields = {
      topSiteId: valueField(rowId),
      url,
      title,
      urlRank,
      redirects: preservedString(row.redirects, columns.has("redirects")),
    };

    const finding = createFinding({
      findingKind: "top_site",
      profile: options.profile,
      commitState: options.commitState,
      provenance,
      fields,
    });

    const urlValue = url.state === "value" ? url.value : null;
    const titleValue = title.state === "value" ? title.value : null;
    const rankKey = urlRank.state === "value" ? BigInt(urlRank.value) : null;
    return {
      persisted: {
        finding,
        searchText: [options.profile, urlValue ?? "", titleValue ?? ""]
          .join("\n")
          .toLocaleLowerCase("en-US"),
        sortUrl: urlValue,
        sortTitle: titleValue,
        sortRank: rankKey,
      },
    };
  });
}

function manifestIdentity(
  source: CaseSourceRecord,
  path: string,
  databasePath = path,
): ManifestIdentity | null {
  const ordinal = source.entries.findIndex((entry) => entry.path === path);
  return ordinal < 0
    ? null
    : { sourceId: source.sourceId, ordinal, path, databasePath };
}

function unavailableArtifact(
  sourceId: string,
  profile: string,
  databasePath: string,
  manifestEntryOrdinal: number | null,
  status: "absent" | "unavailable",
  reason: string,
): TopSitesArtifactWrite {
  return {
    sourceId,
    profile,
    status,
    manifestEntryOrdinal,
    databasePath,
    schemaVersion: null,
    integrity: null,
    recoveryStatus: "unavailable",
    reason,
    findings: [],
    committedTopSiteCount: 0,
    recoveredTopSiteCount: 0,
  };
}

async function analyseProfile(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
}): Promise<TopSitesArtifactWrite> {
  const databasePath =
    options.profile === "." ? "Top Sites" : `${options.profile}/Top Sites`;
  const manifest = manifestIdentity(options.source, databasePath);
  if (manifest === null) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      null,
      "absent",
      "top_sites_absent",
    );
  }
  const entry = options.source.entries[manifest.ordinal];
  if (entry === undefined) {
    throw new Error("Manifest ordinal became invalid.");
  }
  if (entry.state === "absent") {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "absent",
      "top_sites_absent",
    );
  }
  if (entry.state === "unavailable") {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      `top_sites_unavailable:${entry.unavailable_reason ?? "unknown"}`,
    );
  }
  if (!entry.copied) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "top_sites_not_in_working_copy",
    );
  }
  if (entry.size === null || entry.sha256 === null) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "top_sites_manifest_representation_incomplete",
    );
  }

  const verifiedDatabase: VerifiedTopSiteFile = {
    path: join(options.workingCopyPath, ...databasePath.split("/")),
    manifestPath: databasePath,
    size: entry.size,
    sha256: entry.sha256,
  };
  const sidecars: VerifiedTopSiteFile[] = options.source.entries
    .filter(
      (candidate) =>
        candidate.copied &&
        candidate.state === "value" &&
        candidate.size !== null &&
        candidate.sha256 !== null &&
        (candidate.path === `${databasePath}-wal` ||
          candidate.path === `${databasePath}-journal`),
    )
    .map((candidate) => ({
      path: join(options.workingCopyPath, ...candidate.path.split("/")),
      manifestPath: candidate.path,
      size: candidate.size as number,
      sha256: candidate.sha256 as string,
    }));

  try {
    const passes = await readTopSitePasses({
      database: verifiedDatabase,
      sidecars,
    });
    const recoveredManifest =
      passes.recovered === null
        ? null
        : manifestIdentity(
            options.source,
            `${databasePath}${
              passes.recovered.commitState === "wal_resident"
                ? "-wal"
                : "-journal"
            }`,
            databasePath,
          );
    if (passes.recovered !== null && recoveredManifest === null) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Top Sites recovery content has no resolvable sidecar Manifest entry.",
        { database_path: databasePath },
      );
    }
    const committed = buildTopSites({
      rows: passes.committed.rows,
      schema: passes.committed.schema,
      commitState: "committed",
      profile: options.profile,
      manifest,
    });
    const recovered =
      passes.recovered === null
        ? []
        : buildTopSites({
            rows: passes.recovered.rows,
            schema: passes.recovered.schema,
            commitState: passes.recovered.commitState,
            profile: options.profile,
            manifest: recoveredManifest as ManifestIdentity,
          });
    return {
      sourceId: options.source.sourceId,
      profile: options.profile,
      status: "complete",
      manifestEntryOrdinal: manifest.ordinal,
      databasePath,
      schemaVersion: passes.committed.schema.version,
      integrity: passes.committed.integrity,
      recoveryStatus: passes.recovered === null ? "unavailable" : "complete",
      reason: passes.recoveryUnavailableReason,
      findings: [...committed, ...recovered].map((site) => site.persisted),
      committedTopSiteCount: committed.length,
      recoveredTopSiteCount: recovered.length,
    };
  } catch (error) {
    if (error instanceof WorkingCopyIntegrityRefusal) {
      throw error;
    }
    const reason =
      error instanceof ForensixError
        ? `${error.code}:${error.message}`
        : `top_sites_read_failed:${String(error)}`;
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      reason,
    );
  }
}

export interface TopSitesAnalysisInput {
  readonly source: CaseSourceRecord;
  readonly workingCopyPath: string;
}

export async function analyseSourceTopSites(
  input: TopSitesAnalysisInput,
): Promise<TopSitesArtifactWrite[]> {
  const artifacts: TopSitesArtifactWrite[] = [];
  for (const profile of input.source.profiles) {
    artifacts.push(
      await analyseProfile({
        source: input.source,
        profile: profile.path,
        workingCopyPath: input.workingCopyPath,
      }),
    );
  }
  return artifacts;
}

export type { Finding as TopSiteFinding };
