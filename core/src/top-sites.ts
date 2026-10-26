import type {
  PersistedTopSiteFinding,
  TopSitesArtifactWrite,
} from "./case-findings.js";
import type { CaseSourceRecord } from "./case.js";
import { ForensixError } from "./errors.js";
import { createFinding, valueField, type Finding } from "./forensic-model.js";
import {
  citedPasses,
  completeArtifactHeader,
  preservedInteger,
  preservedString,
  readFailureHeader,
  resolveProfileDatabase,
  sourceRowProvenance,
  type CitedPass,
  type SqliteArtifactHeader,
} from "./sqlite-artifact.js";
import { readTopSitePasses, type TopSitePass } from "./top-sites-sqlite.js";

function buildTopSites(
  cited: CitedPass<TopSitePass>,
  profile: string,
): PersistedTopSiteFinding[] {
  const columns = cited.pass.schema.columns;
  return cited.pass.rows.map((row) => {
    if (typeof row.rowId !== "bigint") {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Top Sites rowid is not an exact integer.",
      );
    }
    const rowId = row.rowId.toString();
    const url = preservedString(row.url, columns.has("url"));
    const title = preservedString(row.title, columns.has("title"));
    const urlRank = preservedInteger(row.urlRank, columns.has("url_rank"));
    const finding = createFinding({
      findingKind: "top_site",
      profile,
      commitState: cited.commitState,
      provenance: {
        ...sourceRowProvenance(cited.manifest, "top_sites", rowId),
        ...(cited.recoveredVia === undefined
          ? {}
          : { recoveredVia: cited.recoveredVia }),
      },
      fields: {
        topSiteId: valueField(rowId),
        url,
        title,
        urlRank,
        redirects: preservedString(row.redirects, columns.has("redirects")),
      },
    });

    const urlValue = url.state === "value" ? url.value : null;
    const titleValue = title.state === "value" ? title.value : null;
    return {
      finding,
      searchText: [profile, urlValue ?? "", titleValue ?? ""]
        .join("\n")
        .toLocaleLowerCase("en-US"),
      sortUrl: urlValue,
      sortTitle: titleValue,
      sortRank: urlRank.state === "value" ? BigInt(urlRank.value) : null,
    };
  });
}

function unavailableArtifact(
  header: SqliteArtifactHeader,
): TopSitesArtifactWrite {
  return {
    ...header,
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
  const resolved = resolveProfileDatabase({
    ...options,
    label: "top_sites",
    relativePaths: ["Top Sites"],
  });
  if (!resolved.readable) {
    return unavailableArtifact(resolved.header);
  }
  const { target } = resolved;
  try {
    const passes = await readTopSitePasses(target);
    const cited = citedPasses(target, passes);
    const committed = buildTopSites(cited.committed, options.profile);
    const recovered =
      cited.recovered === null
        ? []
        : buildTopSites(cited.recovered, options.profile);
    return {
      ...completeArtifactHeader(target, passes),
      findings: [...committed, ...recovered],
      committedTopSiteCount: committed.length,
      recoveredTopSiteCount: recovered.length,
    };
  } catch (error) {
    return unavailableArtifact(readFailureHeader(target, "top_sites", error));
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
