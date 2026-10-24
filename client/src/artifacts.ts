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

/** Every Completeness artifact the Sites view groups by host. */
export const SITES_COVERAGE: readonly string[] = [
  "History",
  "Cookies",
  "Login Data",
  "Bookmarks",
  "Top Sites",
  "Web Data",
];
