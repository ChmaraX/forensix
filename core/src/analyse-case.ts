import { resolve } from "node:path";

import { analyseSourceBookmarks } from "./bookmarks.js";
import { analyseSourceCache } from "./cache.js";
import {
  storeHistoryAnalysis,
  type AnalysisRunExitState,
  type BookmarksArtifactWrite,
  type CacheArtifactWrite,
  type CookieArtifactWrite,
  type DeclaredOriginOs,
  type DownloadsArtifactWrite,
  type FaviconArtifactWrite,
  type HistoryArtifactWrite,
  type LoginDataArtifactWrite,
  type MetadataArtifactWrite,
  type TopSitesArtifactWrite,
  type WebDataArtifactWrite,
} from "./case-findings.js";
import { loadCaseSources, workingCopyAbsolutePath } from "./case.js";
import { analyseSourceCookies } from "./cookies.js";
import { analyseDownloadsProfile } from "./downloads.js";
import { ForensixError } from "./errors.js";
import { analyseSourceFavicons } from "./favicons.js";
import {
  classifyHistoryTopics,
  type TopicCandidateSummary,
} from "./history-topic-classification.js";
import { analyseProfile, validateDeclaredTimezone } from "./history.js";
import { generateCaseCandidates } from "./identity-candidates.js";
import { analyseLoginDataProfile } from "./login-data.js";
import {
  loadAuthorizedKeyMaterial,
  type KeyMaterialIssue,
} from "./key-material.js";
import { DECRYPTION_DISABLED, type DecryptionSettings } from "./oscrypt.js";
import { analyseSourcePreferences } from "./preferences.js";
import { analyseSourceTopSites } from "./top-sites.js";
import { type EmbeddingEngine } from "./topic-candidates.js";
import { verifyWorkingCopy, type WorkingCopyVerification } from "./verify.js";
import { analyseWebDataProfile } from "./web-data.js";

export interface AnalyseCaseOptions {
  readonly caseDirectory: string;
  readonly declaredTimezone?: string;
  readonly declaredOriginOs?: DeclaredOriginOs;
  readonly invocation?: readonly string[];
  /**
   * Explicit operator opt-in to offline OSCrypt decryption. Disabled by
   * default. When enabled, `keyMaterialPath` is required; encrypted values stay
   * `unavailable` with typed reasons whenever key material is missing or fails.
   */
  readonly decryptionEnabled?: boolean;
  /** Path to supplied or captured authorized key material with Provenance. */
  readonly keyMaterialPath?: string;
  /** Recipient X25519 private key (PEM) used to unseal captured key material. */
  readonly recipientKeyPath?: string;
  /**
   * Local topic classification. Enabled by default. The settled ONNX model runs
   * only when its optional runtime and model directory are present; otherwise a
   * typed unavailability is recorded. Disabling it, or removing the model,
   * leaves every source artifact row byte-for-byte unchanged. Candidates are
   * additive and live in a separate collection.
   */
  readonly topicClassification?: {
    readonly enabled?: boolean;
    /** Inject an engine (tests, alternate deployments). Overrides the loader. */
    readonly engine?: EmbeddingEngine;
  };
}

export interface DecryptionSummary {
  readonly enabled: boolean;
  readonly keyMaterialCount: number;
  readonly keyMaterialIssueCount: number;
}

export interface HistoryAnalysisSummary {
  readonly status: "complete" | "partial";
  readonly profileCount: number;
  readonly analysedProfileCount: number;
  readonly absentProfileCount: number;
  readonly unavailableProfileCount: number;
  readonly recoveryUnavailableProfileCount: number;
  readonly committedVisitCount: number;
  readonly recoveredVisitCount: number;
  readonly findingCount: number;
  readonly candidateCount: number;
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
  readonly declaredOriginOsConflict: boolean;
}

export interface CookieAnalysisSummary {
  readonly status: "complete" | "partial";
  readonly profileCount: number;
  readonly analysedProfileCount: number;
  readonly absentProfileCount: number;
  readonly unavailableProfileCount: number;
  readonly recoveryUnavailableProfileCount: number;
  readonly committedCookieCount: number;
  readonly recoveredCookieCount: number;
  readonly findingCount: number;
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
}

/**
 * Distinct, documented exit codes for the `analyse` command. The Case is the
 * record of truth for the exit state; these codes map each recorded Analysis
 * Run exit state onto a stable process exit code so operators and scripts can
 * tell a clean analysis from a partial or failed one.
 *
 * - `complete` (0): every artifact produced defensible results.
 * - `partial` (2): at least one artifact was unavailable, but other artifacts
 *   produced defensible, queryable results.
 * - `failed` (3): the analysis produced no defensible artifact result.
 *
 * Usage errors, a missing Case, and a Working Copy integrity refusal exit with
 * the generic error code 1 handled by the CLI entrypoint.
 */
export const ANALYSE_EXIT_CODES = {
  complete: 0,
  partial: 2,
  failed: 3,
} as const satisfies Record<AnalysisRunExitState, number>;

export interface LoginDataAnalysisSummary {
  readonly status: "complete" | "partial";
  readonly profileCount: number;
  readonly analysedProfileCount: number;
  readonly absentProfileCount: number;
  readonly unavailableProfileCount: number;
  readonly committedCredentialCount: number;
  readonly recoveredCredentialCount: number;
  readonly findingCount: number;
}

export interface TopSitesAnalysisSummary {
  readonly status: "complete" | "partial";
  readonly profileCount: number;
  readonly analysedProfileCount: number;
  readonly absentProfileCount: number;
  readonly unavailableProfileCount: number;
  readonly recoveryUnavailableProfileCount: number;
  readonly committedTopSiteCount: number;
  readonly recoveredTopSiteCount: number;
  readonly findingCount: number;
}

export interface WebDataAnalysisSummary {
  readonly status: "complete" | "partial";
  readonly profileCount: number;
  readonly analysedProfileCount: number;
  readonly absentProfileCount: number;
  readonly unavailableProfileCount: number;
  readonly committedFieldCount: number;
  readonly recoveredFieldCount: number;
  readonly findingCount: number;
}

export interface FaviconsAnalysisSummary {
  readonly status: "complete" | "partial";
  readonly profileCount: number;
  readonly analysedProfileCount: number;
  readonly absentProfileCount: number;
  readonly unavailableProfileCount: number;
  readonly recoveryUnavailableProfileCount: number;
  readonly committedFaviconCount: number;
  readonly recoveredFaviconCount: number;
  readonly payloadFileCount: number;
  readonly findingCount: number;
}

export interface DownloadsAnalysisSummary {
  readonly status: "complete" | "partial";
  readonly profileCount: number;
  readonly analysedProfileCount: number;
  readonly absentProfileCount: number;
  readonly unavailableProfileCount: number;
  readonly recoveryUnavailableProfileCount: number;
  readonly committedDownloadCount: number;
  readonly recoveredDownloadCount: number;
  readonly findingCount: number;
}

export interface PreferencesAnalysisSummary {
  readonly status: "complete" | "partial";
  readonly artifactCount: number;
  readonly analysedArtifactCount: number;
  readonly absentArtifactCount: number;
  readonly unavailableArtifactCount: number;
  readonly browserMetadataCount: number;
  readonly profileMetadataCount: number;
  readonly findingCount: number;
}

export interface BookmarksAnalysisSummary {
  readonly status: "complete" | "partial";
  readonly profileCount: number;
  readonly primaryAnalysedCount: number;
  readonly backupAnalysedCount: number;
  readonly absentCount: number;
  readonly unavailableCount: number;
  readonly bookmarkCount: number;
  readonly findingCount: number;
  readonly declaredTimezone: string;
}

export interface CacheAnalysisSummary {
  readonly status: "complete" | "partial";
  readonly profileCount: number;
  readonly analysedProfileCount: number;
  readonly absentProfileCount: number;
  readonly unavailableProfileCount: number;
  readonly candidateCount: number;
  readonly payloadFileCount: number;
  readonly findingCount: number;
}

export interface AnalyseCaseResult extends WorkingCopyVerification {
  readonly command: "analyse";
  readonly analysisStatus: "ready";
  readonly artifactCount: number;
  readonly runId: string;
  readonly exitState: AnalysisRunExitState;
  readonly history: HistoryAnalysisSummary;
  readonly cookies: CookieAnalysisSummary;
  readonly loginData: LoginDataAnalysisSummary;
  readonly topSites: TopSitesAnalysisSummary;
  readonly webData: WebDataAnalysisSummary;
  readonly favicons: FaviconsAnalysisSummary;
  readonly downloads: DownloadsAnalysisSummary;
  readonly preferences: PreferencesAnalysisSummary;
  readonly bookmarks: BookmarksAnalysisSummary;
  readonly cache: CacheAnalysisSummary;
  readonly decryption: DecryptionSummary;
  readonly topicCandidates: TopicCandidateSummary;
}

/**
 * Run one Analysis Run over a Case and store its Findings and Candidates.
 *
 * The pass first verifies the Working Copy, then reads every Source and Profile
 * and runs each artifact parser (History, Cookies, Login Data, Top Sites, Web
 * Data, Favicons, Downloads, Preferences, Bookmarks, Cache). It classifies
 * History topics and derives identity and behavior Candidates from the Findings
 * it just wrote. It verifies the Working Copy again, then stores the run.
 *
 * The pass is offline and never mutates a Source byte. Decryption is opt-in and
 * disabled by default. When it is enabled, `keyMaterialPath` is required, and
 * an encrypted value stays `unavailable` with a typed reason whenever key
 * material is missing or fails.
 *
 * Returns the per-artifact summaries, the new `runId`, and the run exit state.
 */
export async function analyseCase(
  options: AnalyseCaseOptions,
): Promise<AnalyseCaseResult> {
  const caseDirectory = resolve(options.caseDirectory);
  const declaredTimezone = validateDeclaredTimezone(
    options.declaredTimezone ?? "UTC",
  );
  const declaredOriginOs = options.declaredOriginOs ?? null;
  const startedAt = new Date().toISOString();
  let decryption: DecryptionSettings = DECRYPTION_DISABLED;
  let keyMaterialIssues: readonly KeyMaterialIssue[] = [];
  if (options.decryptionEnabled === true) {
    if (options.keyMaterialPath === undefined) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "Decryption opt-in requires authorized key material; pass --key-material.",
      );
    }
    const resolved = loadAuthorizedKeyMaterial({
      keyMaterialPath: options.keyMaterialPath,
      ...(options.recipientKeyPath === undefined
        ? {}
        : { recipientKeyPath: options.recipientKeyPath }),
    });
    decryption = { enabled: true, keyMaterial: resolved.material };
    keyMaterialIssues = resolved.issues;
  }
  const verification = await verifyWorkingCopy(caseDirectory);
  const sources = loadCaseSources(caseDirectory);
  const artifacts: HistoryArtifactWrite[] = [];
  const cookieArtifacts: CookieArtifactWrite[] = [];
  const loginDataArtifacts: LoginDataArtifactWrite[] = [];
  const topSitesArtifacts: TopSitesArtifactWrite[] = [];
  const webDataArtifacts: WebDataArtifactWrite[] = [];
  const faviconArtifacts: FaviconArtifactWrite[] = [];
  const downloadsArtifacts: DownloadsArtifactWrite[] = [];
  const metadataArtifacts: MetadataArtifactWrite[] = [];
  const bookmarksArtifacts: BookmarksArtifactWrite[] = [];
  const cacheArtifacts: CacheArtifactWrite[] = [];
  for (const source of sources) {
    const workingCopyPath = workingCopyAbsolutePath(caseDirectory, source);
    for (const profile of source.profiles) {
      artifacts.push(
        await analyseProfile({
          source,
          profile: profile.path,
          workingCopyPath,
          declaredTimezone,
          declaredOriginOs,
        }),
      );
      loginDataArtifacts.push(
        await analyseLoginDataProfile({
          source,
          profile: profile.path,
          workingCopyPath,
          declaredTimezone,
          decryption,
        }),
      );
      webDataArtifacts.push(
        await analyseWebDataProfile({
          source,
          profile: profile.path,
          workingCopyPath,
          declaredTimezone,
        }),
      );
      downloadsArtifacts.push(
        await analyseDownloadsProfile({
          source,
          profile: profile.path,
          workingCopyPath,
          declaredTimezone,
        }),
      );
    }
    cookieArtifacts.push(
      ...(await analyseSourceCookies({
        source,
        workingCopyPath,
        declaredTimezone,
        declaredOriginOs,
        decryption,
      })),
    );
    topSitesArtifacts.push(
      ...(await analyseSourceTopSites({
        source,
        workingCopyPath,
      })),
    );
    faviconArtifacts.push(
      ...(await analyseSourceFavicons({
        source,
        workingCopyPath,
        caseDirectory,
        declaredTimezone,
      })),
    );
    metadataArtifacts.push(
      ...(await analyseSourcePreferences({ source, workingCopyPath })),
    );
    bookmarksArtifacts.push(
      ...(await analyseSourceBookmarks({
        source,
        workingCopyPath,
        declaredTimezone,
      })),
    );
    cacheArtifacts.push(
      ...(await analyseSourceCache({
        source,
        workingCopyPath,
        caseDirectory,
        declaredTimezone,
      })),
    );
  }

  const classification = await classifyHistoryTopics(
    artifacts,
    options.topicClassification,
  );

  // Identity and behavior Candidates are derived from the Findings just
  // produced: Web Data autofill, Preferences/Local State metadata, and History
  // visits. Generation reads those Findings and never mutates them.
  const candidateArtifacts = generateCaseCandidates({
    sources,
    historyArtifacts: artifacts,
    webDataArtifacts,
    metadataArtifacts,
  });

  await verifyWorkingCopy(caseDirectory);
  const stored = storeHistoryAnalysis({
    caseDirectory,
    sourceIds: sources.map((source) => source.sourceId),
    declaredTimezone,
    declaredOriginOs,
    invocation: options.invocation ?? ["analyse", "--case", caseDirectory],
    startedAt,
    artifacts: classification.artifacts,
    cookieArtifacts,
    loginDataArtifacts,
    topSitesArtifacts,
    webDataArtifacts,
    faviconArtifacts,
    downloadsArtifacts,
    metadataArtifacts,
    bookmarksArtifacts,
    cacheArtifacts,
    candidateArtifacts,
  });
  const singletonLockPresent = sources.some((source) =>
    source.entries.some(
      (entry) =>
        entry.path === "SingletonLock" &&
        entry.state === "value" &&
        entry.node_type === "symlink",
    ),
  );
  const analysed = artifacts.filter(
    (artifact) => artifact.status === "complete",
  );
  const absent = artifacts.filter((artifact) => artifact.status === "absent");
  const unavailable = artifacts.filter(
    (artifact) => artifact.status === "unavailable",
  );
  const cookiesAnalysed = cookieArtifacts.filter(
    (artifact) => artifact.status === "complete",
  );
  const cookiesAbsent = cookieArtifacts.filter(
    (artifact) => artifact.status === "absent",
  );
  const cookiesUnavailable = cookieArtifacts.filter(
    (artifact) => artifact.status === "unavailable",
  );
  const loginAnalysed = loginDataArtifacts.filter(
    (artifact) => artifact.status === "complete",
  );
  const loginAbsent = loginDataArtifacts.filter(
    (artifact) => artifact.status === "absent",
  );
  const loginUnavailable = loginDataArtifacts.filter(
    (artifact) => artifact.status === "unavailable",
  );
  const topSitesAnalysed = topSitesArtifacts.filter(
    (artifact) => artifact.status === "complete",
  );
  const topSitesAbsent = topSitesArtifacts.filter(
    (artifact) => artifact.status === "absent",
  );
  const topSitesUnavailable = topSitesArtifacts.filter(
    (artifact) => artifact.status === "unavailable",
  );
  const webAnalysed = webDataArtifacts.filter(
    (artifact) => artifact.status === "complete",
  );
  const webAbsent = webDataArtifacts.filter(
    (artifact) => artifact.status === "absent",
  );
  const webUnavailable = webDataArtifacts.filter(
    (artifact) => artifact.status === "unavailable",
  );
  const faviconsAnalysed = faviconArtifacts.filter(
    (artifact) => artifact.status === "complete",
  );
  const faviconsAbsent = faviconArtifacts.filter(
    (artifact) => artifact.status === "absent",
  );
  const faviconsUnavailable = faviconArtifacts.filter(
    (artifact) => artifact.status === "unavailable",
  );
  const downloadsAnalysed = downloadsArtifacts.filter(
    (artifact) => artifact.status === "complete",
  );
  const downloadsAbsent = downloadsArtifacts.filter(
    (artifact) => artifact.status === "absent",
  );
  const downloadsUnavailable = downloadsArtifacts.filter(
    (artifact) => artifact.status === "unavailable",
  );
  const metadataAnalysed = metadataArtifacts.filter(
    (artifact) => artifact.status === "complete",
  );
  const metadataAbsent = metadataArtifacts.filter(
    (artifact) => artifact.status === "absent",
  );
  const metadataUnavailable = metadataArtifacts.filter(
    (artifact) => artifact.status === "unavailable",
  );
  const bookmarksAnalysed = bookmarksArtifacts.filter(
    (artifact) => artifact.status === "complete",
  );
  const bookmarksAbsent = bookmarksArtifacts.filter(
    (artifact) => artifact.status === "absent",
  );
  const bookmarksUnavailable = bookmarksArtifacts.filter(
    (artifact) => artifact.status === "unavailable",
  );
  const cacheAnalysed = cacheArtifacts.filter(
    (artifact) => artifact.status === "complete",
  );
  const cacheAbsent = cacheArtifacts.filter(
    (artifact) => artifact.status === "absent",
  );
  const cacheUnavailable = cacheArtifacts.filter(
    (artifact) => artifact.status === "unavailable",
  );
  return {
    ...verification,
    command: "analyse",
    analysisStatus: "ready",
    artifactCount:
      analysed.length +
      cookiesAnalysed.length +
      loginAnalysed.length +
      topSitesAnalysed.length +
      webAnalysed.length +
      faviconsAnalysed.length +
      downloadsAnalysed.length +
      cacheAnalysed.length,
    runId: stored.runId,
    exitState: stored.runStatus,
    cookies: {
      status: cookiesUnavailable.length === 0 ? "complete" : "partial",
      profileCount: sources.reduce(
        (count, source) => count + source.profiles.length,
        0,
      ),
      analysedProfileCount: cookiesAnalysed.length,
      absentProfileCount: cookiesAbsent.length,
      unavailableProfileCount: cookiesUnavailable.length,
      recoveryUnavailableProfileCount: cookiesAnalysed.filter(
        (artifact) => artifact.recoveryStatus === "unavailable",
      ).length,
      committedCookieCount: cookiesAnalysed.reduce(
        (count, artifact) => count + artifact.committedCookieCount,
        0,
      ),
      recoveredCookieCount: cookiesAnalysed.reduce(
        (count, artifact) => count + artifact.recoveredCookieCount,
        0,
      ),
      findingCount: cookiesAnalysed.reduce(
        (count, artifact) => count + artifact.findings.length,
        0,
      ),
      declaredTimezone,
      declaredOriginOs,
    },
    history: {
      status: unavailable.length === 0 ? "complete" : "partial",
      profileCount: sources.reduce(
        (count, source) => count + source.profiles.length,
        0,
      ),
      analysedProfileCount: analysed.length,
      absentProfileCount: absent.length,
      unavailableProfileCount: unavailable.length,
      recoveryUnavailableProfileCount: analysed.filter(
        (artifact) => artifact.recoveryStatus === "unavailable",
      ).length,
      committedVisitCount: analysed.reduce(
        (count, artifact) => count + artifact.committedVisitCount,
        0,
      ),
      recoveredVisitCount: analysed.reduce(
        (count, artifact) => count + artifact.recoveredVisitCount,
        0,
      ),
      findingCount: analysed.reduce(
        (count, artifact) => count + artifact.findings.length,
        0,
      ),
      candidateCount: classification.summary.candidateCount,
      declaredTimezone,
      declaredOriginOs,
      declaredOriginOsConflict:
        declaredOriginOs === "windows" && singletonLockPresent,
    },
    loginData: {
      status: loginUnavailable.length === 0 ? "complete" : "partial",
      profileCount: sources.reduce(
        (count, source) => count + source.profiles.length,
        0,
      ),
      analysedProfileCount: loginAnalysed.length,
      absentProfileCount: loginAbsent.length,
      unavailableProfileCount: loginUnavailable.length,
      committedCredentialCount: loginAnalysed.reduce(
        (count, artifact) => count + artifact.committedCredentialCount,
        0,
      ),
      recoveredCredentialCount: loginAnalysed.reduce(
        (count, artifact) => count + artifact.recoveredCredentialCount,
        0,
      ),
      findingCount: loginAnalysed.reduce(
        (count, artifact) => count + artifact.findings.length,
        0,
      ),
    },
    topSites: {
      status: topSitesUnavailable.length === 0 ? "complete" : "partial",
      profileCount: sources.reduce(
        (count, source) => count + source.profiles.length,
        0,
      ),
      analysedProfileCount: topSitesAnalysed.length,
      absentProfileCount: topSitesAbsent.length,
      unavailableProfileCount: topSitesUnavailable.length,
      recoveryUnavailableProfileCount: topSitesAnalysed.filter(
        (artifact) => artifact.recoveryStatus === "unavailable",
      ).length,
      committedTopSiteCount: topSitesAnalysed.reduce(
        (count, artifact) => count + artifact.committedTopSiteCount,
        0,
      ),
      recoveredTopSiteCount: topSitesAnalysed.reduce(
        (count, artifact) => count + artifact.recoveredTopSiteCount,
        0,
      ),
      findingCount: topSitesAnalysed.reduce(
        (count, artifact) => count + artifact.findings.length,
        0,
      ),
    },
    webData: {
      status: webUnavailable.length === 0 ? "complete" : "partial",
      profileCount: sources.reduce(
        (count, source) => count + source.profiles.length,
        0,
      ),
      analysedProfileCount: webAnalysed.length,
      absentProfileCount: webAbsent.length,
      unavailableProfileCount: webUnavailable.length,
      committedFieldCount: webAnalysed.reduce(
        (count, artifact) => count + artifact.committedFieldCount,
        0,
      ),
      recoveredFieldCount: webAnalysed.reduce(
        (count, artifact) => count + artifact.recoveredFieldCount,
        0,
      ),
      findingCount: webAnalysed.reduce(
        (count, artifact) => count + artifact.findings.length,
        0,
      ),
    },
    favicons: {
      status: faviconsUnavailable.length === 0 ? "complete" : "partial",
      profileCount: sources.reduce(
        (count, source) => count + source.profiles.length,
        0,
      ),
      analysedProfileCount: faviconsAnalysed.length,
      absentProfileCount: faviconsAbsent.length,
      unavailableProfileCount: faviconsUnavailable.length,
      recoveryUnavailableProfileCount: faviconsAnalysed.filter(
        (artifact) => artifact.recoveryStatus === "unavailable",
      ).length,
      committedFaviconCount: faviconsAnalysed.reduce(
        (count, artifact) => count + artifact.committedFaviconCount,
        0,
      ),
      recoveredFaviconCount: faviconsAnalysed.reduce(
        (count, artifact) => count + artifact.recoveredFaviconCount,
        0,
      ),
      payloadFileCount: faviconsAnalysed.reduce(
        (count, artifact) => count + artifact.payloadFileCount,
        0,
      ),
      findingCount: faviconsAnalysed.reduce(
        (count, artifact) => count + artifact.findings.length,
        0,
      ),
    },
    downloads: {
      status: downloadsUnavailable.length === 0 ? "complete" : "partial",
      profileCount: sources.reduce(
        (count, source) => count + source.profiles.length,
        0,
      ),
      analysedProfileCount: downloadsAnalysed.length,
      absentProfileCount: downloadsAbsent.length,
      unavailableProfileCount: downloadsUnavailable.length,
      recoveryUnavailableProfileCount: downloadsAnalysed.filter(
        (artifact) => artifact.recoveryStatus === "unavailable",
      ).length,
      committedDownloadCount: downloadsAnalysed.reduce(
        (count, artifact) => count + artifact.committedDownloadCount,
        0,
      ),
      recoveredDownloadCount: downloadsAnalysed.reduce(
        (count, artifact) => count + artifact.recoveredDownloadCount,
        0,
      ),
      findingCount: downloadsAnalysed.reduce(
        (count, artifact) => count + artifact.findings.length,
        0,
      ),
    },
    preferences: {
      status: metadataUnavailable.length === 0 ? "complete" : "partial",
      artifactCount: metadataArtifacts.length,
      analysedArtifactCount: metadataAnalysed.length,
      absentArtifactCount: metadataAbsent.length,
      unavailableArtifactCount: metadataUnavailable.length,
      browserMetadataCount: metadataAnalysed.filter(
        (artifact) => artifact.artifact === "Local State",
      ).length,
      profileMetadataCount: metadataAnalysed.filter(
        (artifact) => artifact.artifact === "Preferences",
      ).length,
      findingCount: metadataAnalysed.reduce(
        (count, artifact) => count + artifact.findings.length,
        0,
      ),
    },
    bookmarks: {
      status: bookmarksUnavailable.length === 0 ? "complete" : "partial",
      profileCount: sources.reduce(
        (count, source) => count + source.profiles.length,
        0,
      ),
      primaryAnalysedCount: bookmarksAnalysed.filter(
        (artifact) => artifact.artifact === "Bookmarks",
      ).length,
      backupAnalysedCount: bookmarksAnalysed.filter(
        (artifact) => artifact.artifact === "Bookmarks.bak",
      ).length,
      absentCount: bookmarksAbsent.length,
      unavailableCount: bookmarksUnavailable.length,
      bookmarkCount: bookmarksAnalysed.reduce(
        (count, artifact) => count + artifact.bookmarkCount,
        0,
      ),
      findingCount: bookmarksAnalysed.reduce(
        (count, artifact) => count + artifact.findings.length,
        0,
      ),
      declaredTimezone,
    },
    cache: {
      status: cacheUnavailable.length === 0 ? "complete" : "partial",
      profileCount: sources.reduce(
        (count, source) => count + source.profiles.length,
        0,
      ),
      analysedProfileCount: cacheAnalysed.length,
      absentProfileCount: cacheAbsent.length,
      unavailableProfileCount: cacheUnavailable.length,
      candidateCount: cacheAnalysed.reduce(
        (count, artifact) => count + artifact.candidateCount,
        0,
      ),
      payloadFileCount: cacheAnalysed.reduce(
        (count, artifact) => count + artifact.payloadFileCount,
        0,
      ),
      findingCount: cacheAnalysed.reduce(
        (count, artifact) => count + artifact.findings.length,
        0,
      ),
    },
    decryption: {
      enabled: decryption.enabled,
      keyMaterialCount: decryption.keyMaterial.length,
      keyMaterialIssueCount: keyMaterialIssues.length,
    },
    topicCandidates: classification.summary,
  };
}
