/**
 * The evidence kinds Sites groups by host (core's `SiteArtifactKind`), in
 * reading order - activity first, then stored identity data, then the
 * browser's traces of the site - with the words and icon each is shown
 * with: the host list's summary, the kind chips and panels, ⌘K's host rows.
 *
 * One table, typed over every kind core groups, so a kind core adds is a
 * compile error here until it has its words.
 */
import { ARTIFACT_ICONS, type AppIcon } from "@/lib/app-icons";

import type { SiteArtifactKind, SiteHost } from "../types.js";
import { plural } from "./page-kit.js";

export interface SiteKindMeta {
  readonly kind: SiteArtifactKind;
  /** The panel and chip title ("Saved logins"). */
  readonly label: string;
  /** The row noun for a count ("1 visit", "2 visits"). */
  readonly one: string;
  readonly many: string;
  /** One row of the kind, as the row sheet's title ("Page visit"). */
  readonly singular: string;
  readonly icon: AppIcon;
}

const KINDS: {
  readonly [Kind in SiteArtifactKind]: SiteKindMeta & { readonly kind: Kind };
} = {
  visits: {
    kind: "visits",
    label: "Visits",
    one: "visit",
    many: "visits",
    singular: "Page visit",
    icon: ARTIFACT_ICONS.history,
  },
  downloads: {
    kind: "downloads",
    label: "Downloads",
    one: "download",
    many: "downloads",
    singular: "Download",
    icon: ARTIFACT_ICONS.downloads,
  },
  cookies: {
    kind: "cookies",
    label: "Cookies",
    one: "cookie",
    many: "cookies",
    singular: "Cookie",
    icon: ARTIFACT_ICONS.cookies,
  },
  saved_logins: {
    kind: "saved_logins",
    label: "Saved logins",
    one: "saved login",
    many: "saved logins",
    singular: "Saved login",
    icon: ARTIFACT_ICONS.credentials,
  },
  bookmarks: {
    kind: "bookmarks",
    label: "Bookmarks",
    one: "bookmark",
    many: "bookmarks",
    singular: "Bookmark",
    icon: ARTIFACT_ICONS.bookmarks,
  },
  top_sites: {
    kind: "top_sites",
    label: "Top sites",
    one: "top site",
    many: "top sites",
    singular: "Top site",
    icon: ARTIFACT_ICONS["top-sites"],
  },
  favicons: {
    kind: "favicons",
    label: "Favicons",
    one: "favicon",
    many: "favicons",
    singular: "Favicon",
    icon: ARTIFACT_ICONS.favicons,
  },
  cache: {
    kind: "cache",
    label: "Cache",
    one: "cache entry",
    many: "cache entries",
    singular: "Cache entry",
    icon: ARTIFACT_ICONS.cache,
  },
};

/** Every kind, in reading order (the order of `KINDS`). */
export const SITE_KINDS: readonly SiteKindMeta[] = Object.values(KINDS);

/** One kind's words and icon. */
export function siteKind(kind: SiteArtifactKind): SiteKindMeta {
  return KINDS[kind];
}

/** Saved rows a host carries across every kind: the host list's count and
 *  order. Recovered rows are never summed in. */
export function savedTotalOf(host: SiteHost): number {
  return Object.values(host.savedCounts).reduce((sum, count) => sum + count, 0);
}

/** Rows a host carries across every kind, every Commit State. */
export function rowsTotalOf(host: SiteHost): number {
  return Object.values(host.counts).reduce((sum, count) => sum + count, 0);
}

/** "4 visits · 1 cookie" - a host's saved rows per kind, in reading order;
 *  "Recovered rows only" when it has no saved row at all. */
export function hostSummary(host: SiteHost): string {
  const saved = SITE_KINDS.filter((meta) => host.savedCounts[meta.kind] > 0);
  return saved.length === 0
    ? "Recovered rows only"
    : saved
        .map((meta) => plural(host.savedCounts[meta.kind], meta.one, meta.many))
        .join(" · ");
}
