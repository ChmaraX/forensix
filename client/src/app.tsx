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
 *  - sidecar (WAL / rollback-journal) rows are a separate list from
 *    committed rows, never mixed in;
 *  - no Candidate value is shown on a tile.
 *
 * The shell is Fluid Functionalism's App Sidebar block (sidebar-app):
 * SidebarProvider + an inset Sidebar + SidebarInset with its topbar. Pages
 * render inside one `reveal-product` column (see FLUID.md).
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { callApi } from "./api.js";
import logoMark from "./assets/forensix-logo.png";
import { ARTIFACTS, SITES_COVERAGE, TIMELINE_COVERAGE } from "./artifacts.js";
import { AutofillPage } from "./components/autofill-page.js";
import { BookmarksPage } from "./components/bookmarks-page.js";
import { CachePage } from "./components/cache-page.js";
import {
  CoverageBanner,
  CoverageIndicator,
} from "./components/completeness.js";
import { CookiesPage } from "./components/cookies-page.js";
import { CredentialsPage } from "./components/credentials-page.js";
import { DownloadsPage } from "./components/downloads-page.js";
import { FaviconsPage } from "./components/favicons-page.js";
import { HistoryPage } from "./components/history-page.js";
import { ErrorRows, LoadingRows } from "./components/list-states.js";
import { MetadataPage } from "./components/metadata-page.js";
import { SidebarInsetTopbar } from "./components/sidebar-app/inset-topbar.js";
import {
  SidebarWorkspaceHeader,
  WorkspaceTile,
} from "./components/sidebar-app/workspace-header.js";
import { SitesPage } from "./components/sites-page.js";
import { TimelinePage } from "./components/timeline-page.js";
import { TopSitesPage } from "./components/top-sites-page.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "./components/ui/sidebar.js";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { ARTIFACT_ICONS, type AppIcon } from "./lib/app-icons.js";
import { FluidProvider } from "./lib/fluid-provider.js";
import { fontWeights } from "./lib/font-weight.js";
import { untitleduiIcons } from "./lib/icons-untitledui.js";
import { typeClass } from "./lib/size-context.js";
import { SurfaceProvider } from "./lib/surface-context.js";
import { cn } from "./lib/utils.js";
import { OverviewPage } from "./overview.js";
import { ThemeToggle } from "./theme.js";
import type {
  ArtifactConfig,
  CaseCompleteness,
  CaseProfiles,
} from "./types.js";

/**
 * The brand mark on FF's 20px workspace tile: the cutout logo painted in the
 * page color on a foreground tile, the same treatment as a workspace letter.
 */
function BrandTile() {
  return (
    <WorkspaceTile>
      <span
        className="size-3.5"
        style={{
          backgroundColor: "var(--background)",
          maskImage: `url(${logoMark})`,
          maskSize: "contain",
          maskRepeat: "no-repeat",
          maskPosition: "center",
        }}
      />
    </WorkspaceTile>
  );
}

interface NavTarget {
  readonly key: string;
  readonly label: string;
  readonly config: ArtifactConfig | null;
  readonly icon: AppIcon;
  readonly timeline?: boolean;
  readonly sites?: boolean;
}

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
 * Icons come from `ARTIFACT_ICONS` (lib/app-icons, Untitled UI), picked for
 * what each record type *is*. They follow the FF sidebar rows: muted at
 * rest, foreground and a heavier stroke on the active or hovered row.
 */
const NAV_ICONS: Readonly<Record<string, AppIcon>> = ARTIFACT_ICONS;
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
          icon: NAV_ICONS[config.key] ?? ARTIFACT_ICONS.cache,
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
        icon: ARTIFACT_ICONS.overview,
      },
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
        icon: ARTIFACT_ICONS.timeline,
      },
      {
        key: "sites",
        label: "Sites",
        config: null,
        sites: true,
        icon: ARTIFACT_ICONS.sites,
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
  icon: ARTIFACT_ICONS.overview,
};

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

/** The section a target belongs to, for the topbar trail. */
function groupOf(target: NavTarget): string {
  return (
    NAV_GROUPS.find((group) =>
      group.targets.some((entry) => entry.key === target.key),
    )?.label ?? ""
  );
}

/**
 * The sidebar: brand row, one SidebarGroup per nav group, theme control in
 * the footer. Rows are FF SidebarMenuButtons, so hover glides between them
 * and the active background follows the selection. On a narrow screen the
 * same sidebar is FF's drawer; picking a row closes it.
 */
function CaseSidebar({
  activeKey,
  onSelect,
}: {
  readonly activeKey: string;
  readonly onSelect: (target: NavTarget) => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <Sidebar variant="inset" aria-label="Case sections">
      <SidebarHeader>
        <SidebarWorkspaceHeader name="ForensiX" tile={<BrandTile />} />
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu aria-label={group.label}>
              {group.targets.map((target) => (
                <SidebarMenuItem key={target.key}>
                  <SidebarMenuButton
                    icon={target.icon}
                    isActive={target.key === activeKey}
                    aria-current={target.key === activeKey ? "page" : undefined}
                    onClick={() => {
                      onSelect(target);
                      if (isMobile) {
                        setOpenMobile(false);
                      }
                    }}
                  >
                    {target.label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <ThemeToggle />
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * The Completeness artifact keys a page lists, for its coverage indicator
 * and banner: the artifact's own key, or every artifact a merged view reads.
 */
function coverageScopeOf(target: NavTarget): readonly string[] | undefined {
  if (target.timeline === true) {
    return TIMELINE_COVERAGE;
  }
  if (target.sites === true) {
    return SITES_COVERAGE;
  }
  return target.config === null
    ? undefined
    : [target.config.completenessArtifact];
}

/**
 * The page title on the display role, with an optional trailing `aside`
 * on the same row (the shell puts the page's coverage indicator there).
 */
function PageHeader({
  title,
  aside,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
}) {
  return (
    <header className="flex min-w-0 items-center justify-between gap-3 pt-2">
      <h1
        className={cn(typeClass("display"), "min-w-0 text-foreground")}
        style={{ fontVariationSettings: fontWeights.bold }}
      >
        {title}
      </h1>
      {aside}
    </header>
  );
}

/**
 * The page for a nav target. Evidence coverage is the shell's: the page's
 * indicator sits in its title row and, when something was not read, a
 * banner sits above the page (forensic rule 1).
 */
function ActivePage({
  target,
  context,
  sitesPreselect,
}: {
  readonly target: NavTarget;
  readonly context: CaseContext;
  readonly sitesPreselect: string | null;
}) {
  const { profiles } = context;
  if (target.timeline === true) {
    return <TimelinePage />;
  }
  if (target.sites === true) {
    return <SitesPage initialHost={sitesPreselect} />;
  }
  const config = target.config;
  switch (config?.key) {
    case "history":
      return <HistoryPage profiles={profiles} />;
    case "top-sites":
      return <TopSitesPage config={config} />;
    case "downloads":
      return <DownloadsPage config={config} />;
    case "bookmarks":
      return <BookmarksPage config={config} />;
    case "cookies":
      return <CookiesPage config={config} />;
    case "favicons":
      return <FaviconsPage config={config} />;
    case "metadata":
      return <MetadataPage config={config} />;
    case "autofill":
      return <AutofillPage config={config} />;
    case "credentials":
      return <CredentialsPage config={config} />;
    case "cache":
      return <CachePage config={config} />;
    default:
      // Every artifact in ARTIFACTS has a page above.
      return null;
  }
}

/**
 * Application shell.
 *
 * FF's App Sidebar: a resizable, collapsible inset sidebar (drag its edge,
 * press `[`, or the topbar trigger; collapsed, it peeks back on hover) and a
 * drawer below 768px. Its open state is not persisted: the dashboard writes
 * nothing it does not need, and the cookie FF uses would ride along on every
 * API request.
 *
 * The content column is one `reveal-product` container keyed by the page, so
 * each page fades in (header first, then the body) when it opens. The column
 * re-provides surface level 2 — the inset's own level — so Panels land on
 * surface 3 and popups walk up the ladder from there.
 */
export function App() {
  const [active, setActive] = useState<NavTarget>(DEFAULT_TARGET);
  // Set only by the Top sites card's row click, and read only by the Sites
  // page's own initial state — it is not "the current host", just the one
  // pending handoff into a page the click is about to mount fresh.
  const [sitesPreselect, setSitesPreselect] = useState<string | null>(null);
  const { context, error, retry } = useCaseContext();

  // A direct nav click always means "go here empty" — only the Top sites
  // card's own click is allowed to carry a preselected host into Sites.
  const selectTarget = useCallback((target: NavTarget) => {
    setSitesPreselect(null);
    setActive(target);
  }, []);

  // The Overview's per-panel jump links resolve a section key against the
  // same NAV_GROUPS the sidebar renders, so a link can never point somewhere
  // the sidebar does not. The optional second argument is the Top sites
  // card's one extra case: a host to preselect once the Sites page mounts.
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

  // A new page starts at the top, as a fresh screen would.
  useEffect(() => {
    globalThis.scrollTo({ top: 0 });
  }, [active]);

  return (
    <FluidProvider icons={untitleduiIcons}>
      <TooltipProvider delayDuration={150}>
        <SidebarProvider persist={false} peek="hover">
          <CaseSidebar activeKey={active.key} onSelect={selectTarget} />
          {/* Below the drawer breakpoint the rail is gone; keep the inset card
              off the left edge as it is off the right. */}
          <SidebarInset className="max-md:ml-2!">
            {/* The sticky bar wears the inset's own surface (level 2) and
                frame, so rows pass under it instead of showing through the
                breadcrumb, and FF's scroll-divider hairline plus a short
                fade appear once the page scrolls (`.inset-topbar`). */}
            <div className="inset-topbar">
              <SidebarInsetTopbar className="px-2">
                <nav
                  aria-label="Breadcrumb"
                  className={cn(
                    "flex min-w-0 items-center gap-1.5",
                    typeClass("body"),
                  )}
                >
                  <span className="truncate text-muted-foreground">
                    {groupOf(active)}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    /
                  </span>
                  <span
                    aria-current="page"
                    className="truncate text-foreground"
                  >
                    {active.label}
                  </span>
                </nav>
              </SidebarInsetTopbar>
            </div>
            <SurfaceProvider value={2}>
              <div
                key={active.key}
                className="reveal-product mx-auto flex w-full max-w-[1360px] min-w-0 flex-col gap-5 px-4 pb-10 md:px-8"
              >
                {/* Overview builds its own masthead as its first block and
                    states coverage in its Readable figure. */}
                {active.key === "overview" ? null : (
                  <PageHeader
                    title={active.label}
                    aside={
                      context === null ? null : (
                        <CoverageIndicator
                          completeness={context.completeness}
                          artifacts={coverageScopeOf(active)}
                        />
                      )
                    }
                  />
                )}
                {active.key === "overview" || context === null ? null : (
                  <CoverageBanner
                    completeness={context.completeness}
                    artifacts={coverageScopeOf(active)}
                  />
                )}
                {active.key === "overview" ? (
                  <OverviewPage onOpen={openSection} />
                ) : error !== null ? (
                  <ErrorRows message={error} onRetry={retry} className="px-0" />
                ) : context === null ? (
                  <LoadingRows className="px-0" />
                ) : (
                  <ActivePage
                    target={active}
                    context={context}
                    sitesPreselect={sitesPreselect}
                  />
                )}
              </div>
            </SurfaceProvider>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </FluidProvider>
  );
}
