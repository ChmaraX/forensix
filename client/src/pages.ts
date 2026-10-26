/**
 * Every page the shell can show, in nav order: what it is called, which
 * sidebar group it sits in, which evidence its coverage indicator speaks
 * for, and which parts of the Case-wide lens it applies. The one table the
 * router, the shell, the lens chip and ⌘K read; the page components and
 * icons are bound to the same keys in `page-views.tsx`.
 *
 * Pure (no React): the router and its tests import it.
 */
import {
  ARTIFACTS,
  EVIDENCE_ORDER,
  SITES_COVERAGE,
  TIMELINE_COVERAGE,
  type ArtifactConfig,
} from "./artifacts.js";
import type { OverviewArtifact } from "./types.js";

export const PAGE_KEYS = [
  "overview",
  "candidates",
  "timeline",
  "sites",
  ...EVIDENCE_ORDER,
] as const;

export type PageKey = (typeof PAGE_KEYS)[number];

export type PageGroup = "Case" | "Views" | "Evidence";

export interface PageMeta {
  readonly label: string;
  /** The sidebar group: "Case" states conclusions about the evidence,
   *  "Views" regroup it, "Evidence" is the evidence. */
  readonly group: PageGroup;
  /** The Completeness artifacts the page's coverage speaks for; null for
   *  the whole Case (Overview). */
  readonly coverage: readonly OverviewArtifact[] | null;
  /** The artifact page's own read, or null for a merged view. */
  readonly artifact: ArtifactConfig | null;
  /** The parts of the Case-wide lens the page applies. */
  readonly lens: {
    /** The recorded time the page narrows a date range by ("visit time"),
     *  or null when it takes no date. A page that applies the range shows
     *  it on its own date picker too. */
    readonly range: string | null;
    readonly profiles: boolean;
  };
  /** The page builds its own masthead and coverage (Overview): the shell
   *  adds no header or banner. */
  readonly ownHeader?: boolean;
}

/** The profile pick only (an evidence page without a date filter). */
const PROFILES_ONLY = { range: null, profiles: true } as const;

function evidence(
  artifact: ArtifactConfig,
  range: string | null = null,
): PageMeta {
  return {
    label: artifact.label,
    group: "Evidence",
    coverage: [artifact.completenessArtifact],
    artifact,
    lens: range === null ? PROFILES_ONLY : { range, profiles: true },
  };
}

export const PAGES: Readonly<Record<PageKey, PageMeta>> = {
  overview: {
    label: "Overview",
    group: "Case",
    coverage: null,
    artifact: null,
    lens: { range: "visit day", profiles: false },
    ownHeader: true,
  },
  // Ranked identity and behavior hypotheses: conclusions drawn from the
  // evidence, never evidence themselves.
  candidates: {
    label: "Candidates",
    group: "Case",
    coverage: ["Candidates"],
    artifact: null,
    // `candidates` takes a profile, never a date.
    lens: PROFILES_ONLY,
  },
  timeline: {
    label: "Timeline",
    group: "Views",
    coverage: TIMELINE_COVERAGE,
    artifact: null,
    lens: { range: "each event's own time", profiles: true },
  },
  sites: {
    label: "Sites",
    group: "Views",
    coverage: SITES_COVERAGE,
    artifact: null,
    // `site-hosts` takes neither a date nor a profile.
    lens: { range: null, profiles: false },
  },
  history: evidence(ARTIFACTS.history, "visit time"),
  downloads: evidence(ARTIFACTS.downloads, "start time"),
  bookmarks: evidence(ARTIFACTS.bookmarks),
  "top-sites": evidence(ARTIFACTS["top-sites"]),
  cookies: evidence(ARTIFACTS.cookies),
  credentials: evidence(ARTIFACTS.credentials),
  autofill: evidence(ARTIFACTS.autofill),
  cache: evidence(ARTIFACTS.cache, "last used time"),
  favicons: evidence(ARTIFACTS.favicons),
  metadata: evidence(ARTIFACTS.metadata),
};

export const DEFAULT_PAGE: PageKey = "overview";

const KEYS: ReadonlySet<string> = new Set(PAGE_KEYS);

export function isPageKey(text: string): text is PageKey {
  return KEYS.has(text);
}
