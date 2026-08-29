/**
 * Read-only Case dashboard.
 *
 * This client contains no forensic logic and performs no Case writes. It only
 * renders what the read-only loopback API returns from the analyzer core. It
 * offers no control that could start or rerun ingest, analysis, or export.
 *
 * Presentation rules enforced across the app:
 *  - the Completeness Statement (shown as "Evidence coverage") renders before
 *    any row;
 *  - TYPE is always the first column;
 *  - value / (empty) / absent / unavailable are distinct words, never color
 *    alone;
 *  - Candidates ("Leads") are never shown as factual summary tiles.
 */
import {
  Bookmark,
  ClipboardList,
  Cookie,
  Database,
  Download,
  Fingerprint,
  Globe,
  History as HistoryIcon,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  ListOrdered,
  Menu,
  Image as SiteImageIcon,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { callApi, type QueryParameters } from "./api.js";
import logoMark from "./assets/forensix-logo.png";
import { ARTIFACTS, SIDECAR_STATES } from "./artifacts.js";
import {
  candidateGuessField,
  CandidatesTable,
  FindingsTable,
} from "./components/data-table.js";
import { CompletenessPanel } from "./components/completeness.js";
import { MaybeFieldStateText } from "./components/field-state.js";
import {
  FilterBar,
  filterParameters,
  initialFilters,
  type FilterState,
} from "./components/filters.js";
import { RowSheet, type SelectedRow } from "./components/row-sheet.js";
import {
  TimelineActivityCard,
  type DayRange,
} from "./components/timeline-activity.js";
import {
  TimelineRecordsCard,
  type TimelineDirection,
} from "./components/timeline-table.js";
import { TopSitesPage } from "./components/top-sites-page.js";
import { SitesPage } from "./components/sites-page.js";
import { Button } from "./components/ui/button.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "./components/ui/sheet.js";
import { Skeleton } from "./components/ui/misc.js";
import { Term, TooltipProvider } from "./components/ui/tooltip.js";
import { cn } from "./lib.js";
import { OverviewPage } from "./overview.js";
import { COMMIT_META, LeadsNote } from "./terms.js";
import { ThemeToggle } from "./theme.js";
import type {
  ArtifactConfig,
  CandidateRecord,
  CaseCompleteness,
  CaseProfiles,
  CommitState,
  Finding,
  PageOf,
  TopicCandidateRecord,
} from "./types.js";

/**
 * Brand lockup: a tiled mark and the wordmark.
 *
 * The mark used to sit bare — currentColor on the page, no tile — which meant
 * it inverted to a plain white shape on a plain black one in dark mode: the
 * exact flat, colourless look this pass exists to fix. It now sits on a
 * flat solid `--accent-strong` tile — the one vivid brand block on the
 * whole screen, no gradient, no glow — so the brand carries the identity
 * and everything else stays quiet. The cutout mark paints in
 * `--accent-strong-foreground` (white in both modes), the standard
 * mark-on-brand-tile pairing of the professional dashboards this surface
 * sits alongside.
 *
 * The wordmark picks up the same accent in one letter — "X", where the
 * mark's cursor is pointing — a small, specific echo rather than a second
 * logo treatment.
 */
function Brand() {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[14px]"
        style={{ background: "var(--accent-strong)" }}
      >
        <span
          className="h-6 w-6"
          style={{
            backgroundColor: "var(--accent-strong-foreground)",
            maskImage: `url(${logoMark})`,
            maskSize: "contain",
            maskRepeat: "no-repeat",
            maskPosition: "center",
          }}
        />
      </span>
      {/* Sized against the tile, not the UI scale, so identity reads as one
          object with it rather than a caption underneath it. */}
      <p className="text-[22px] leading-none font-bold tracking-[-0.04em]">
        Forensi<span style={{ color: "var(--accent-strong)" }}>X</span>
      </p>
    </div>
  );
}

/** One keyset-paginated list over a read-only API route. */
function usePaginatedList<Row>(
  route: string,
  parameters: QueryParameters,
  enabled = true,
) {
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const parametersKey = JSON.stringify(parameters);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setLoading(false);
      setError(null);
      setRows([]);
      setCursor(null);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    setRows([]);
    setCursor(null);
    callApi<PageOf<Row>>(route, parameters)
      .then((page) => {
        if (cancelled) {
          return;
        }
        setRows(page.items);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [route, parametersKey, reloadNonce, enabled]);

  const loadMore = useCallback(() => {
    if (!enabled || cursor === null) {
      return;
    }
    setLoading(true);
    setError(null);
    callApi<PageOf<Row>>(route, [...parameters, ["after", cursor]])
      .then((page) => {
        setRows((existing) => [...existing, ...page.items]);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
        setLoading(false);
      });
  }, [route, parametersKey, cursor, enabled]);

  const retry = useCallback(() => {
    setReloadNonce((nonce) => nonce + 1);
  }, []);

  return { rows, cursor, loading, error, loadMore, retry };
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2 px-4 py-4" aria-label="Loading rows">
      {[0, 1, 2, 3, 4].map((index) => (
        <Skeleton key={index} className="h-7 w-full" />
      ))}
    </div>
  );
}

function ErrorRows({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-4 my-4 flex items-start gap-2.5 rounded-md border border-destructive-border bg-destructive-wash px-3.5 py-3"
    >
      <div className="flex-1">
        <p className="text-[13px] font-medium text-destructive">
          The rows could not be loaded.
        </p>
        <p className="text-[12.5px] text-destructive/80">{message}</p>
      </div>
      <Button onClick={onRetry} size="sm" className="shrink-0">
        Retry
      </Button>
    </div>
  );
}

function ListFooter({
  count,
  cursor,
  loading,
  onLoadMore,
}: {
  readonly count: number;
  readonly cursor: string | null;
  readonly loading: boolean;
  readonly onLoadMore: () => void;
}) {
  if (count === 0 && cursor === null) {
    return null;
  }
  return (
    <div className="flex items-center gap-3 border-t border-border/70 px-4 py-2.5">
      <p
        className="text-[12.5px] text-muted-foreground tabular-nums"
        aria-live="polite"
      >
        {count} row{count === 1 ? "" : "s"} shown
        {cursor === null ? "" : " · more available"}
      </p>
      {cursor !== null ? (
        <Button onClick={onLoadMore} disabled={loading} size="sm">
          {loading ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}

function ListCard({
  title,
  titleExtra,
  count,
  children,
}: {
  readonly title: React.ReactNode;
  readonly titleExtra?: React.ReactNode;
  readonly count: number;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <span className="text-[12px] text-muted-foreground tabular-nums">
          {count}
        </span>
        {titleExtra}
      </header>
      {children}
    </section>
  );
}

/** Committed or sidecar Finding list; each list pins exactly one Commit State. */
function FindingList({
  config,
  base,
  commitStates,
  title,
  onSelect,
}: {
  readonly config: ArtifactConfig;
  readonly base: QueryParameters;
  readonly commitStates: readonly CommitState[];
  readonly title: React.ReactNode;
  readonly onSelect: (row: Finding) => void;
}) {
  const [commitState, setCommitState] = useState<CommitState>(
    commitStates[0] ?? "committed",
  );
  const parameters = useMemo<QueryParameters>(
    () =>
      commitStates.length === 0
        ? base
        : [...base, ["commit-state", commitState]],
    [base, commitStates.length, commitState],
  );
  const list = usePaginatedList<Finding>(config.route, parameters);

  return (
    <ListCard
      title={title}
      count={list.rows.length}
      titleExtra={
        commitStates.length > 1 ? (
          <div
            role="group"
            aria-label="Recovered-from"
            className="ml-auto inline-flex overflow-hidden rounded-md border border-border bg-muted p-0.5"
          >
            {commitStates.map((state) => (
              <button
                key={state}
                type="button"
                aria-pressed={commitState === state}
                onClick={() => {
                  setCommitState(state);
                }}
                className={cn(
                  "inline-flex h-6 cursor-pointer items-center gap-1.5 rounded px-2.5 text-[12px] font-medium transition-colors duration-150",
                  commitState === state
                    ? "border border-border bg-card shadow-xs"
                    : "border border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full",
                    state === "wal_resident" ? "bg-wal" : "bg-violet",
                  )}
                />
                {COMMIT_META[state].label}
              </button>
            ))}
          </div>
        ) : null
      }
    >
      {list.error !== null ? (
        <ErrorRows message={list.error} onRetry={list.retry} />
      ) : list.loading && list.rows.length === 0 ? (
        <LoadingRows />
      ) : (
        <FindingsTable rows={list.rows} onSelect={onSelect} />
      )}
      <ListFooter
        count={list.rows.length}
        cursor={list.cursor}
        loading={list.loading}
        onLoadMore={list.loadMore}
      />
    </ListCard>
  );
}

/**
 * Two read-at-a-glance tiles above the Leads filters: the strongest identity
 * guess and the strongest behavior guess, ranked #1 in their own category.
 * This fetches its own unfiltered, rank-sorted copy of the Leads list,
 * independent of whatever the table's own Category/Kind/Search filters are
 * currently set to — "what's the single strongest guess" should hold
 * steady even while the table below is being filtered down.
 */
function LeadHighlights({ config }: { readonly config: ArtifactConfig }) {
  const list = usePaginatedList<CandidateRecord | TopicCandidateRecord>(
    config.route,
    [
      ["sort", "rank"],
      ["direction", "asc"],
    ],
  );
  const topOf = (category: "identity" | "behavior") =>
    list.rows.find(
      (row): row is CandidateRecord =>
        "category" in row && row.category === category && row.rank === 1,
    );
  const topIdentity = topOf("identity");
  const topBehavior = topOf("behavior");
  const tiles = [
    topIdentity === undefined
      ? null
      : { label: "Top identity guess", lead: topIdentity },
    topBehavior === undefined
      ? null
      : { label: "Top behavior guess", lead: topBehavior },
  ].filter(
    (tile): tile is { label: string; lead: CandidateRecord } => tile !== null,
  );
  if (list.loading || tiles.length === 0) {
    return null;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3"
        >
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {tile.label}
          </span>
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            <MaybeFieldStateText field={candidateGuessField(tile.lead)} />
          </span>
          <span className="text-[12px] text-muted-foreground">
            {tile.lead.supportingCount} supporting rows
          </span>
        </div>
      ))}
    </div>
  );
}

function CandidateList({
  config,
  base,
  onSelect,
}: {
  readonly config: ArtifactConfig;
  readonly base: QueryParameters;
  readonly onSelect: (row: CandidateRecord | TopicCandidateRecord) => void;
}) {
  const list = usePaginatedList<CandidateRecord | TopicCandidateRecord>(
    config.route,
    base,
  );
  return (
    <ListCard title={`Ranked ${config.label}`} count={list.rows.length}>
      {list.error !== null ? (
        <ErrorRows message={list.error} onRetry={list.retry} />
      ) : list.loading && list.rows.length === 0 ? (
        <LoadingRows />
      ) : (
        <CandidatesTable rows={list.rows} onSelect={onSelect} />
      )}
      <ListFooter
        count={list.rows.length}
        cursor={list.cursor}
        loading={list.loading}
        onLoadMore={list.loadMore}
      />
    </ListCard>
  );
}

function TimelinePage() {
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [range, setRange] = useState<DayRange>({ from: "", to: "" });
  const [direction, setDirection] = useState<TimelineDirection>("desc");
  // A selected day range maps to whole-day UTC instants: local dates can read
  // up to a day wider than the true local bounds, which only ever widens the
  // window — it can never hide evidence.
  const parameters = useMemo<QueryParameters>(() => {
    const result: (readonly [string, string])[] = [["direction", direction]];
    if (range.from !== "") {
      result.push(["from", `${range.from}T00:00:00Z`]);
    }
    if (range.to !== "") {
      result.push(["to", `${range.to}T23:59:59.999999Z`]);
    }
    return result;
  }, [range, direction]);
  const list = usePaginatedList<Finding>("timeline", parameters);

  return (
    <div className="flex flex-col gap-4">
      <TimelineActivityCard range={range} onRangeChange={setRange} />
      {/* This stays one stream: splitting commit states would hide chronology. */}
      <TimelineRecordsCard
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        cursor={list.cursor}
        onLoadMore={list.loadMore}
        onRetry={list.retry}
        onSelect={(row) => {
          setSelected({ kind: "finding", row });
        }}
        direction={direction}
        onDirectionChange={setDirection}
        rangeActive={range.from !== "" || range.to !== ""}
      />
      {selected !== null ? (
        <RowSheet
          selected={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ArtifactPage({
  config,
  completeness,
  profiles,
}: {
  readonly config: ArtifactConfig;
  readonly completeness: CaseCompleteness;
  readonly profiles: readonly string[];
}) {
  const [filters, setFilters] = useState<FilterState>(() =>
    initialFilters(config),
  );
  const [selected, setSelected] = useState<SelectedRow | null>(null);

  useEffect(() => {
    setFilters(initialFilters(config));
    setSelected(null);
  }, [config]);

  const base = useMemo(() => filterParameters(filters), [filters]);
  const statement = completeness.statements.find(
    (entry) => entry.artifact === config.completenessArtifact,
  );

  return (
    <div className="flex flex-col gap-4">
      {config.singleList === true && config.key !== LEADS_KEY ? (
        <LeadsNote />
      ) : null}

      {config.key === LEADS_KEY ? (
        <LeadHighlights config={config} />
      ) : (
        // Evidence coverage always renders before any row — except on Leads,
        // where it read as a second, more confusing completeness widget on
        // top of the one already on Overview and added nothing an examiner
        // acts on here.
        <CompletenessPanel statement={statement} />
      )}

      <FilterBar
        config={config}
        profiles={profiles}
        filters={filters}
        onChange={setFilters}
      />

      {config.singleList === true ? (
        <CandidateList
          config={config}
          base={base}
          onSelect={(row) => {
            setSelected({ kind: "candidate", row });
          }}
        />
      ) : config.combinedFindingList === true ? (
        <FindingList
          config={config}
          base={base}
          // Cache returns committed and recovered rows together; requesting a
          // commit-state it does not support would duplicate the same evidence.
          commitStates={[]}
          title="Cache records"
          onSelect={(row) => {
            setSelected({ kind: "finding", row });
          }}
        />
      ) : (
        <>
          <FindingList
            config={config}
            base={base}
            commitStates={["committed"]}
            title={
              <Term label="Saved records">
                Rows Chrome had fully saved in its database — normal data.
                <span className="mt-1 block font-mono text-[11px] opacity-70">
                  Technical: Commit State committed
                </span>
              </Term>
            }
            onSelect={(row) => {
              setSelected({ kind: "finding", row });
            }}
          />
          <FindingList
            config={config}
            base={base}
            commitStates={SIDECAR_STATES}
            title={
              <Term label="Recovered records">
                Rows the analyzer recovered from Chrome's temporary files — data
                that was unsaved, deleted, or being overwritten when Chrome
                stopped.
                <span className="mt-1 block font-mono text-[11px] opacity-70">
                  Technical: WAL / rollback-journal sidecars
                </span>
              </Term>
            }
            onSelect={(row) => {
              setSelected({ kind: "finding", row });
            }}
          />
        </>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}

interface NavTarget {
  readonly key: string;
  readonly label: string;
  readonly config: ArtifactConfig | null;
  readonly icon: LucideIcon;
  readonly timeline?: boolean;
  readonly sites?: boolean;
}

/**
 * Leads is a Candidates artifact page, but it is not evidence: it is what the
 * analyzer inferred *from* the evidence. It is therefore grouped with Overview,
 * away from the raw tables it was derived from.
 */
const LEADS_KEY = "candidates";

const LEADS_CONFIG = ARTIFACTS.find((config) => config.key === LEADS_KEY);

interface NavGroup {
  readonly label: string;
  readonly targets: readonly NavTarget[];
}

/**
 * Two groups, named by what the pages under them are, not by where they sit.
 * "Case" states conclusions about the evidence; "Evidence" is the evidence.
 * The split is what lets nine tables read as one set instead of nine peers of
 * the Overview.
 *
 * Icons are picked for what each record type *is*, not for decoration: Top
 * sites is ranking (`TrendingUp`), the Sites view is host identity (`Globe`),
 * Bookmarks is the saved-page glyph, Favicons is the image glyph — the four
 * that used to collapse into one repeated "site" mark now read apart at a
 * glance. Idle icons sit at the same muted weight as idle text; only the
 * active row's icon takes the interactive blue, so icons never compete with
 * the one color reserved for "you can act on this."
 */
const NAV_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  candidates: Lightbulb,
  timeline: ListOrdered,
  sites: Globe,
  history: HistoryIcon,
  downloads: Download,
  bookmarks: Bookmark,
  "top-sites": TrendingUp,
  cookies: Cookie,
  credentials: KeyRound,
  autofill: ClipboardList,
  cache: Database,
  favicons: SiteImageIcon,
  metadata: Fingerprint,
};
/**
 * Evidence is ordered for investigation: activity first, then stored identity
 * data, with browser metadata last as context about the environment.
 */
const EVIDENCE_KEYS = [
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

const EVIDENCE_TARGETS: readonly NavTarget[] = EVIDENCE_KEYS.flatMap((key) => {
  const config = ARTIFACTS.find((artifact) => artifact.key === key);
  return config === undefined
    ? []
    : [
        {
          key: config.key,
          label: config.label,
          config,
          icon: NAV_ICONS[config.key] ?? Database,
        },
      ];
});

const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Case",
    targets: [
      {
        key: "overview",
        label: "Overview",
        config: null,
        icon: LayoutDashboard,
      },
      ...(LEADS_CONFIG === undefined
        ? []
        : [
            {
              key: LEADS_KEY,
              label: LEADS_CONFIG.label,
              config: LEADS_CONFIG,
              icon: NAV_ICONS[LEADS_KEY] ?? Lightbulb,
            },
          ]),
    ],
  },
  {
    label: "Views",
    targets: [
      {
        key: "timeline",
        label: "Timeline",
        config: null,
        timeline: true,
        icon: ListOrdered,
      },
      {
        key: "sites",
        label: "Sites",
        config: null,
        sites: true,
        icon: Globe,
      },
    ],
  },
  {
    label: "Evidence",
    targets: EVIDENCE_TARGETS,
  },
];

const DEFAULT_TARGET: NavTarget = NAV_GROUPS[0]?.targets[0] ?? {
  key: "overview",
  label: "Overview",
  config: null,
  icon: LayoutDashboard,
};

/**
 * The navigation list itself, shared by the fixed rail and the narrow-screen
 * drawer so the two can never drift apart.
 *
 * The active row is a quiet accent wash — pale blue ground, blue text and
 * icon — the calm current-page treatment of the professional dashboards
 * this surface sits alongside; the vivid blue lives only in the brand tile.
 * Blue is the interactive family and nothing else, so a nav marker can
 * never be misread as an evidence hue. One washed row in the whole column,
 * so the current page is readable from the edge of vision without reading a
 * single label. The state changes as a plain 150ms colour transition — no
 * sliding pill, no spring — because a read-only evidence surface earns
 * trust by sitting still. Icons hold the idle text weight (`foreground/40`)
 * so they read as structure, not decoration; only a hovered or active icon
 * takes the accent, and it never moves. Rows are 40px (not 36px) so the
 * same list works as a touch target in the mobile drawer, not just a mouse
 * target in the rail.
 */
function NavList({
  activeKey,
  onSelect,
}: {
  readonly activeKey: string;
  readonly onSelect: (target: NavTarget) => void;
}) {
  return (
    <nav aria-label="Case sections" className="flex flex-col gap-7">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="mb-1 px-3 text-[11px] font-medium tracking-[0.06em] text-foreground/65 uppercase">
            {group.label}
          </p>
          {group.targets.map((target) => {
            const active = target.key === activeKey;
            const environmentMetadata =
              group.label === "Evidence" && target.key === "metadata";
            const Icon = target.icon;
            return (
              <div
                key={target.key}
                className={cn(
                  environmentMetadata && "mt-2 border-t border-border/70 pt-2",
                )}
              >
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    onSelect(target);
                  }}
                  className={cn(
                    "group relative flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left text-[13px] transition-colors duration-150",
                    active
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-foreground/70 hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0 transition-colors duration-150",
                      active
                        ? "text-accent-foreground"
                        : "text-foreground/50 group-hover:text-primary",
                    )}
                  />
                  <span className="flex-1 truncate">{target.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * Rail contents: identity, the section list, and the theme control.
 *
 * Source and Profile counts used to live here too; they were a standing fact
 * repeated from the Overview page's own stat tiles, competing with the theme
 * control for a footer that only has room to do one thing well. The footer
 * now does the one thing: the theme control, centered because it answers to
 * the whole rail, not to one row in it.
 */
function RailBody({
  activeKey,
  onSelect,
}: {
  readonly activeKey: string;
  readonly onSelect: (target: NavTarget) => void;
}) {
  return (
    <>
      <div className="px-5 pt-5 pb-7">
        <Brand />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        <NavList activeKey={activeKey} onSelect={onSelect} />
      </div>
      <div className="flex items-center justify-center border-t border-border px-5 py-4">
        <ThemeToggle />
      </div>
    </>
  );
}

interface CaseContext {
  readonly completeness: CaseCompleteness;
  readonly profiles: readonly string[];
}

/**
 * The Case-wide reads every artifact page needs. They are fetched once for the
 * whole shell instead of per page, so switching sections does not refetch the
 * Completeness Statement.
 */
function useCaseContext() {
  const [context, setContext] = useState<CaseContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([
      callApi<CaseCompleteness>("completeness", []),
      callApi<CaseProfiles>("profiles", []),
    ])
      .then(([completeness, caseProfiles]) => {
        if (cancelled) {
          return;
        }
        setContext({ completeness, profiles: caseProfiles.profiles });
      })
      .catch((requestError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  const retry = useCallback(() => {
    setContext(null);
    setReloadNonce((nonce) => nonce + 1);
  }, []);

  return { context, error, retry };
}

/**
 * Application shell.
 *
 * Navigation lives in a fixed left rail, not across the top. The decisive
 * constraint is vertical, not horizontal: an evidence page already stacks a
 * title, a description, the Completeness Statement, and a two-row filter bar
 * above the first record. Every horizontal band of navigation pushes the rows —
 * the actual product — further down a screen that is only so tall, while the
 * top bar itself sat two-thirds empty. The rail spends the axis that was going
 * to waste and returns the one that was scarce.
 *
 * It also gives eleven sections somewhere honest to live. Left-aligned in a
 * column they are a scannable list at any length; in a row they were a
 * scrolling smear of pills that had to be read one by one.
 *
 * Below `lg` the rail becomes a drawer behind a menu button. The list is the
 * same component in both, so the two cannot drift.
 */
export function App() {
  const [active, setActive] = useState<NavTarget>(DEFAULT_TARGET);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Set only by the Top sites card's row click, and read only by the Sites
  // page's own initial state — it is not "the current host", just the one
  // pending handoff into a page the click is about to mount fresh.
  const [sitesPreselect, setSitesPreselect] = useState<string | null>(null);
  const { context, error, retry } = useCaseContext();

  // A direct rail click always means "go here empty" — only the Top sites
  // card's own click is allowed to carry a preselected host into Sites.
  const selectTarget = useCallback((target: NavTarget) => {
    setSitesPreselect(null);
    setActive(target);
  }, []);

  const selectAndClose = useCallback(
    (target: NavTarget) => {
      selectTarget(target);
      setDrawerOpen(false);
    },
    [selectTarget],
  );

  // The Overview's per-panel jump links resolve a section key against the
  // same NAV_GROUPS the rail renders, so a link can never point somewhere
  // the rail does not. The optional second argument is the Top sites card's
  // one extra case: a host to preselect once the Sites page mounts.
  const openSection = useCallback((key: string, param?: string) => {
    for (const group of NAV_GROUPS) {
      const target = group.targets.find((entry) => entry.key === key);
      if (target !== undefined) {
        setSitesPreselect(target.sites === true ? (param ?? null) : null);
        setActive(target);
        return;
      }
    }
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={150}>
        {/* The rail and the content column used to center independently: the
            rail sat flush on the viewport edge while the content column
            re-centered itself in whatever space was left, opening a dead
            gap between them on wide screens and making the rail read as a
            separate floating pane rather than part of the same layout. They
            now share one outer bound — rail width plus the content column's
            old 1360px cap — so the two edge gutters this produces on a wide
            screen match each other exactly, and the rail sits directly next
            to the content with no re-centering gap between them. */}
        <div className="mx-auto flex min-h-dvh w-full max-w-[1632px]">
          {/* The rail is its own scroll context pinned to the viewport, so the
              section list never scrolls away from a long evidence table.
              It now floats: inset from the viewport edge on all three open
              sides instead of a flush, square-cornered strip, with its own
              border, radius, and shadow (`--rail-shadow`) making it read as
              a panel sitting on the ground rather than a wall built into it.
              Widened 236px → 272px — the extra room is what let the icon +
              label + count row breathe without tightening the label
              truncation point. */}
          {/* Top inset matches the content column's own `pt-7`, not the
              rail's own `p-3` — otherwise the rail card and the first
              content card start at two different heights and read as
              misaligned panels rather than one row. */}
          <div className="sticky top-0 hidden h-dvh w-[272px] shrink-0 pt-7 pr-3 pb-3 pl-3 lg:flex">
            <div
              className="flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-border bg-card"
              style={{ boxShadow: "var(--rail-shadow)" }}
            >
              <RailBody activeKey={active.key} onSelect={selectTarget} />
            </div>
          </div>

          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent
              className="right-auto left-0 w-[268px] max-w-[82vw] border-l-0 border-r px-0 py-0"
              aria-describedby={undefined}
            >
              <SheetTitle className="sr-only">Case sections</SheetTitle>
              <SheetDescription className="sr-only">
                Move between the Case overview, the analyzer leads, and each
                evidence table.
              </SheetDescription>
              <RailBody activeKey={active.key} onSelect={selectAndClose} />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Narrow screens keep identity and the drawer trigger on one line;
              nothing else earns a permanent band above the content. */}
            <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-border bg-background px-4 py-3 lg:hidden">
              <button
                type="button"
                aria-label="Open Case sections"
                onClick={() => {
                  setDrawerOpen(true);
                }}
                className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground/70 transition-colors duration-150 hover:bg-muted hover:text-foreground"
              >
                <Menu aria-hidden="true" className="size-5" />
              </button>
              <Brand />
            </header>

            <main className="min-w-0 flex-1">
              <div className="flex w-full min-w-0 flex-col gap-5 px-5 pt-7 pb-8 md:px-8">
                {/* The title carries more space above than below it, so the
                  description reads as part of the heading rather than as the
                  first line of the content under it. Overview builds its own
                  masthead as its first card — a floating h1 above it would
                  restate the same "Overview" label the nav row and the card
                  both already say. */}
                {active.key === "overview" ? null : (
                  // Every other "first thing on the page" — the rail's
                  // logo, the Overview masthead card's content — sits
                  // ~20px inside its box's own top edge before any visible
                  // ink starts. A bare heading has no such inset of its
                  // own, so at the same box position it reads as sitting
                  // higher than everything else anchoring the page's top
                  // edge. This restores that same ~20px of optical run-in.
                  <header className="flex flex-col gap-1.5 pt-5">
                    <h1 className="text-[26px] leading-none font-semibold tracking-[-0.03em]">
                      {active.label}
                    </h1>
                    <p className="max-w-[68ch] text-[13px] text-foreground/65">
                      {active.timeline === true
                        ? "Recorded browser events in chronological order, without inference."
                        : active.sites === true
                          ? "Recorded host keys grouped from browser evidence, without inference."
                          : active.config?.description}
                    </p>
                  </header>
                )}
                {active.timeline === true ? (
                  <TimelinePage />
                ) : active.sites === true ? (
                  <SitesPage initialHost={sitesPreselect} />
                ) : active.config === null ? (
                  <OverviewPage onOpen={openSection} />
                ) : error !== null ? (
                  <ErrorRows message={error} onRetry={retry} />
                ) : context === null ? (
                  <LoadingRows />
                ) : active.config.key === "top-sites" ? (
                  <TopSitesPage
                    config={active.config}
                    completeness={context.completeness}
                  />
                ) : (
                  <ArtifactPage
                    config={active.config}
                    completeness={context.completeness}
                    profiles={context.profiles}
                  />
                )}
              </div>
            </main>
          </div>
        </div>
      </TooltipProvider>
    </MotionConfig>
  );
}
