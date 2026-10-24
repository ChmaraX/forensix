import type { ArtifactConfig } from "./types.js";

export const ARTIFACTS: readonly ArtifactConfig[] = [
  {
    key: "history",
    label: "History",
    route: "history",
    completenessArtifact: "History",
    sorts: ["visit-time", "url", "duration", "profile"],
    extras: [
      {
        parameter: "view",
        label: "View",
        options: ["", "visits", "activity", "most-visited", "durations"],
      },
      { parameter: "transition", label: "Transition", placeholder: "any" },
      { parameter: "from", label: "From", placeholder: "ISO instant" },
      { parameter: "to", label: "To", placeholder: "ISO instant" },
    ],
  },
  {
    key: "cookies",
    label: "Cookies",
    route: "cookies",
    completenessArtifact: "Cookies",
    sorts: [
      "host",
      "name",
      "creation-time",
      "expires-time",
      "last-access-time",
      "profile",
    ],
    extras: [
      { parameter: "host", label: "Host key", placeholder: "example.com" },
      {
        parameter: "same-site",
        label: "SameSite",
        options: ["", "no_restriction", "lax", "strict", "unspecified"],
      },
    ],
  },
  {
    key: "credentials",
    label: "Saved logins",
    route: "credentials",
    completenessArtifact: "Login Data",
    sorts: ["created-time", "last-used-time", "origin", "username", "profile"],
    extras: [],
  },
  {
    key: "top-sites",
    label: "Top sites",
    route: "top-sites",
    completenessArtifact: "Top Sites",
    sorts: ["rank", "url", "title", "profile"],
    extras: [],
  },
  {
    key: "downloads",
    label: "Downloads",
    route: "downloads",
    completenessArtifact: "Downloads",
    sorts: [
      "start-time",
      "end-time",
      "target-path",
      "state",
      "total-bytes",
      "profile",
    ],
    extras: [],
  },
  {
    key: "bookmarks",
    label: "Bookmarks",
    route: "bookmarks",
    completenessArtifact: "Bookmarks",
    sorts: ["name", "url", "date-added", "folder", "profile"],
    extras: [
      {
        parameter: "source",
        label: "Source",
        options: ["", "primary", "backup"],
      },
    ],
  },
  {
    key: "autofill",
    label: "Form data",
    route: "autofill",
    completenessArtifact: "Web Data",
    sorts: ["created-time", "last-used-time", "field-name", "value", "profile"],
    extras: [],
  },
  {
    key: "cache",
    label: "Cache",
    route: "cache",
    completenessArtifact: "Cache",
    sorts: ["key", "last-used", "size", "entry-hash", "profile"],
    combinedFindingList: true,
    extras: [{ parameter: "backend", label: "Backend", placeholder: "any" }],
  },
  {
    key: "favicons",
    label: "Favicons",
    route: "favicons",
    completenessArtifact: "Favicons",
    sorts: ["icon-url", "page-url", "last-updated", "width", "profile"],
    extras: [],
  },
  {
    key: "metadata",
    label: "Browser profile",
    route: "metadata",
    completenessArtifact: "Preferences",
    sorts: ["type", "profile"],
    extras: [
      {
        parameter: "type",
        label: "Type",
        options: ["", "browser_metadata", "profile_metadata"],
      },
    ],
  },
];

/** Every Completeness artifact the Timeline merges (core's queryTimeline). */
export const TIMELINE_COVERAGE: readonly string[] = [
  "History",
  "Downloads",
  "Cookies",
  "Web Data",
];

/** Every Completeness artifact the Sites view groups by host: the six the
 *  host list counts, and the three its host view lists by exact URL
 *  host (Downloads, Cache, Favicons). */
export const SITES_COVERAGE: readonly string[] = [
  "History",
  "Downloads",
  "Cookies",
  "Login Data",
  "Bookmarks",
  "Top Sites",
  "Web Data",
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
      /** The artifact page (`ArtifactConfig.key`) listing it. */
      readonly artifact: string;
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
  return ARTIFACTS.find((artifact) => artifact.key === key)?.label ?? null;
}
