/**
 * The evidence pages: one per analysed artifact, in the sidebar's order
 * (activity first, then stored identity data, with browser metadata last
 * as context), each with the route it reads and the Completeness artifact
 * its coverage names.
 */
export const EVIDENCE_ORDER = [
  "history",
  "downloads",
  "bookmarks",
  "top-sites",
  "cookies",
  "credentials",
  "autofill",
  "cache",
  "favicons",
  "metadata",
] as const;

export type EvidenceKey = (typeof EVIDENCE_ORDER)[number];

export interface ArtifactConfig {
  readonly key: EvidenceKey;
  readonly label: string;
  readonly route: string;
  readonly completenessArtifact: string;
  /** Cache records arrive with their Commit State already mixed; the query
   *  cannot filter it. */
  readonly combinedFindingList?: boolean;
}

export const ARTIFACTS: Readonly<Record<EvidenceKey, ArtifactConfig>> = {
  history: {
    key: "history",
    label: "History",
    route: "history",
    completenessArtifact: "History",
  },
  downloads: {
    key: "downloads",
    label: "Downloads",
    route: "downloads",
    completenessArtifact: "Downloads",
  },
  bookmarks: {
    key: "bookmarks",
    label: "Bookmarks",
    route: "bookmarks",
    completenessArtifact: "Bookmarks",
  },
  "top-sites": {
    key: "top-sites",
    label: "Top sites",
    route: "top-sites",
    completenessArtifact: "Top Sites",
  },
  cookies: {
    key: "cookies",
    label: "Cookies",
    route: "cookies",
    completenessArtifact: "Cookies",
  },
  credentials: {
    key: "credentials",
    label: "Saved logins",
    route: "credentials",
    completenessArtifact: "Login Data",
  },
  autofill: {
    key: "autofill",
    label: "Form data",
    route: "autofill",
    completenessArtifact: "Web Data",
  },
  cache: {
    key: "cache",
    label: "Cache",
    route: "cache",
    completenessArtifact: "Cache",
    combinedFindingList: true,
  },
  favicons: {
    key: "favicons",
    label: "Favicons",
    route: "favicons",
    completenessArtifact: "Favicons",
  },
  metadata: {
    key: "metadata",
    label: "Browser profile",
    route: "metadata",
    completenessArtifact: "Preferences",
  },
};

/** Every Completeness artifact the Timeline merges (core's queryTimeline). */
export const TIMELINE_COVERAGE: readonly string[] = [
  "History",
  "Downloads",
  "Cookies",
  "Web Data",
];

/** Every Completeness artifact the Sites view groups by host (core's
 *  `querySiteHosts`: visits, downloads, cookies, saved logins, bookmarks,
 *  top sites, cache entries and favicons). */
export const SITES_COVERAGE: readonly string[] = [
  "History",
  "Downloads",
  "Cookies",
  "Login Data",
  "Bookmarks",
  "Top Sites",
  "Cache",
  "Favicons",
];

/** How Chrome keeps an artifact's evidence, in the word a sentence about
 *  it needs: a SQLite `database`, a plain `file` (Bookmarks, Preferences,
 *  Local State are JSON) or a `folder` of files (the disk cache). */
export type ArtifactStore = "database" | "file" | "folder";

const ARTIFACT_STORES: Readonly<Record<string, ArtifactStore>> = {
  Bookmarks: "file",
  Preferences: "file",
  "Local State": "file",
  Cache: "folder",
};

/** The store word for a Completeness artifact ("No Bookmarks file", "No
 *  Cookies database"); SQLite artifacts, the rest, say database. */
export function artifactStoreOf(completenessArtifact: string): ArtifactStore {
  return ARTIFACT_STORES[completenessArtifact] ?? "database";
}

/**
 * What each Finding kind is, in words, and which artifact page lists it:
 * the row sheet's kind caption, the citation's artifact, the Related
 * block's day. `time` is the field a row is dated by - the same field the
 * Timeline orders it by where the Timeline lists the kind.
 */
export const FINDING_KINDS: Readonly<
  Record<
    string,
    {
      /** The kind as a person says it ("Page visit"). */
      readonly noun: string;
      /** The artifact page listing it. */
      readonly artifact: EvidenceKey;
      /** The timestamp field the row is dated by, if any. */
      readonly time?: string;
    }
  >
> = {
  history_visit: { noun: "Page visit", artifact: "history", time: "visitTime" },
  download: { noun: "Download", artifact: "downloads", time: "startTime" },
  cookie: { noun: "Cookie", artifact: "cookies", time: "creationTime" },
  autofill_entry: {
    noun: "Form entry",
    artifact: "autofill",
    time: "dateLastUsed",
  },
  login_credential: {
    noun: "Saved login",
    artifact: "credentials",
    time: "dateLastUsed",
  },
  top_site: { noun: "Top site", artifact: "top-sites" },
  bookmark: { noun: "Bookmark", artifact: "bookmarks", time: "dateAdded" },
  cache_entry: { noun: "Cache entry", artifact: "cache", time: "lastUsed" },
  favicon: { noun: "Favicon", artifact: "favicons", time: "lastUpdated" },
  browser_metadata: { noun: "Browser metadata", artifact: "metadata" },
  profile_metadata: { noun: "Profile metadata", artifact: "metadata" },
};

/** The artifact's page label for a Finding kind ("History"), or null. */
export function artifactLabelOfKind(kind: string): string | null {
  const key = FINDING_KINDS[kind]?.artifact;
  return key === undefined ? null : ARTIFACTS[key].label;
}
