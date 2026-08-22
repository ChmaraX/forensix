import type { ArtifactConfig, CommitState } from "./types.js";

export const SIDECAR_STATES: readonly CommitState[] = [
  "wal_resident",
  "journal_resident",
];

export const COMMIT_LABELS: Readonly<Record<CommitState, string>> = {
  committed: "committed",
  wal_resident: "WAL-resident",
  journal_resident: "journal-resident",
};

export const ARTIFACTS: readonly ArtifactConfig[] = [
  {
    key: "history",
    label: "History",
    description:
      "Every page visit Chrome recorded, with time, duration, and how the person got there.",
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
    description:
      "Cookies each site stored: who set them, when, and how long they last.",
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
    description:
      "Login entries Chrome stored: site, username, and dates. Passwords stay encrypted and are never shown.",
    route: "credentials",
    completenessArtifact: "Login Data",
    sorts: ["created-time", "last-used-time", "origin", "username", "profile"],
    extras: [],
  },
  {
    key: "top-sites",
    label: "Top sites",
    description: "The sites Chrome itself ranked as most visited.",
    route: "top-sites",
    completenessArtifact: "Top Sites",
    sorts: ["rank", "url", "title", "profile"],
    extras: [],
  },
  {
    key: "downloads",
    label: "Downloads",
    description:
      "Files the browser saved to disk, with source URL, target path, and file size.",
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
    description:
      "Pages the person saved for later, and the folder each one sits in.",
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
    description:
      "Text the person typed into web forms and let Chrome remember, such as names and addresses.",
    route: "autofill",
    completenessArtifact: "Web Data",
    sorts: ["created-time", "last-used-time", "field-name", "value", "profile"],
    extras: [],
  },
  {
    key: "cache",
    label: "Cache",
    description:
      "Cached browser entries, with their keys, use times, sizes, and source rows.",
    route: "cache",
    completenessArtifact: "Cache",
    sorts: ["key", "last-used", "size", "entry-hash", "profile"],
    combinedFindingList: true,
    extras: [{ parameter: "backend", label: "Backend", placeholder: "any" }],
  },
  {
    key: "favicons",
    label: "Favicons",
    description:
      "Site icons Chrome stored, with their page and icon URLs, update times, and source rows.",
    route: "favicons",
    completenessArtifact: "Favicons",
    sorts: ["icon-url", "page-url", "last-updated", "width", "profile"],
    extras: [],
  },
  {
    key: "metadata",
    label: "Browser profile",
    description:
      "Settings and account details Chrome stored about the browser and each profile.",
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
  {
    key: "candidates",
    label: "Leads",
    description:
      "Ranked guesses about identity and behavior, derived from the evidence — never established facts.",
    route: "candidates",
    completenessArtifact: "Candidates",
    sorts: ["rank", "kind", "supporting-count", "value", "profile"],
    directions: ["asc", "desc"],
    singleList: true,
    extras: [
      {
        parameter: "category",
        label: "Category",
        options: ["", "identity", "behavior"],
      },
      { parameter: "kind", label: "Kind", placeholder: "any" },
    ],
  },
  {
    key: "topic-candidates",
    label: "Topic leads",
    description:
      "Ranked topic hypotheses derived from browser evidence — never established facts.",
    route: "topic-candidates",
    completenessArtifact: "History",
    sorts: ["rank", "supporting", "label", "profile"],
    directions: ["asc", "desc"],
    singleList: true,
    extras: [
      { parameter: "label", label: "Label", placeholder: "any" },
      {
        parameter: "commit-state",
        label: "Commit state",
        options: ["", "committed", "wal_resident", "journal_resident"],
      },
    ],
  },
];
