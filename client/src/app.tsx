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
 *  - TYPE is the first column of a table that mixes record types (the
 *    Timeline, Downloads, Form data); a single-type table has none;
 *  - value / (empty) / absent / unavailable are distinct words, never color
 *    alone;
 *  - sidecar (WAL / rollback-journal) rows are a separate list from
 *    committed rows, never mixed in;
 *  - no Candidate value is shown on a tile.
 *
 * The shell is Fluid Functionalism's App Sidebar block (sidebar-app):
 * SidebarProvider + an inset Sidebar + SidebarInset with its topbar. Pages
 * render inside one `reveal-product` column (see FLUID.md).
 *
 * The open page and its view live in the URL hash (router.ts,
 * view-state.tsx): Back / Forward and a refresh restore them. On a page
 * change the shell sets the document title, moves focus to the page's h1
 * and announces the page in a polite live region; the topbar carries the
 * Case-wide lens chip (date range, profiles) and the ⌘K trigger.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import logoMark from "./assets/forensix-logo.png";
import {
  ARTIFACTS,
  artifactStoreOf,
  SITES_COVERAGE,
  TIMELINE_COVERAGE,
} from "./artifacts.js";
import { CaseCommandMenu } from "./command-menu.js";
import { AutofillPage } from "./components/autofill-page.js";
import { BookmarksPage } from "./components/bookmarks-page.js";
import { CachePage } from "./components/cache-page.js";
import {
  CoverageBanner,
  CoverageIndicator,
  coverageOf,
} from "./components/completeness.js";
import { CookiesPage } from "./components/cookies-page.js";
import { CredentialsPage } from "./components/credentials-page.js";
import { DownloadsPage } from "./components/downloads-page.js";
import { FaviconsPage } from "./components/favicons-page.js";
import { HistoryPage } from "./components/history-page.js";
import { EmptyRows } from "./components/data-table.js";
import { ErrorRows, LoadingRows } from "./components/list-states.js";
import { MetadataPage } from "./components/metadata-page.js";
import { Panel } from "./components/panel.js";
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
import { Button } from "./components/ui/button.js";
import { CommandMenuShortcut } from "./components/ui/command-menu.js";
import { ARTIFACT_ICONS, SearchIcon, type AppIcon } from "./lib/app-icons.js";
import { FluidProvider } from "./lib/fluid-provider.js";
import { fontWeights } from "./lib/font-weight.js";
import { untitleduiIcons } from "./lib/icons-untitledui.js";
import { typeClass } from "./lib/size-context.js";
import { SurfaceProvider } from "./lib/surface-context.js";
import { cn } from "./lib/utils.js";
import { OverviewPage } from "./overview.js";
import { RowLookupNotice } from "./components/row-lookup-notice.js";
import { EVIDENCE_ORDER } from "./router.js";
import { useGlobalRowKeys } from "./shortcuts.js";
import { ThemeToggle } from "./theme.js";
import {
  CaseContextProvider,
  useCaseContextRead,
  type CaseContext,
} from "./case-context.js";
import { useLensSummary, ViewLensChip } from "./view-lens.js";
import {
  canonicalizeLocation,
  openPage,
  useViewLocation,
} from "./view-state.js";
import type { ArtifactConfig } from "./types.js";

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
 * Evidence is ordered for investigation (`EVIDENCE_ORDER`, router.ts, which
 * ⌘K lists too): activity first, then stored identity data, with browser
 * metadata last as context about the environment.
 */
const EVIDENCE_KEYS = EVIDENCE_ORDER;

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

/** The nav target for a page key (unknown keys open the Overview). */
function targetOf(key: string): NavTarget {
  for (const group of NAV_GROUPS) {
    const target = group.targets.find((entry) => entry.key === key);
    if (target !== undefined) {
      return target;
    }
  }
  return DEFAULT_TARGET;
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
  /** `fromDrawer`: picked in the phone drawer, which closes on the pick. */
  readonly onSelect: (target: NavTarget, fromDrawer: boolean) => void;
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
                      onSelect(target, isMobile);
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
        tabIndex={-1}
        className={cn(
          typeClass("display"),
          "min-w-0 text-foreground outline-none",
        )}
        style={{ fontVariationSettings: fontWeights.bold }}
      >
        {title}
      </h1>
      {aside}
    </header>
  );
}

/**
 * A single-artifact page none of whose databases could be read: the banner
 * above names the reason; here the page says it has nothing to show because
 * of it — never "no rows in this Case", which would read as an absence.
 */
function UnreadPage({ target }: { readonly target: NavTarget }) {
  return (
    <Panel>
      <EmptyRows
        icon={target.icon}
        message={`No rows to show: no ${target.label} ${
          target.config === null
            ? "database"
            : artifactStoreOf(target.config.completenessArtifact)
        } could be read.`}
      />
    </Panel>
  );
}

/**
 * The page for a nav target. Evidence coverage is the shell's: the page's
 * indicator sits in its title row and, when something was not read, a
 * banner sits above the page (forensic rule 1). A single-artifact page
 * whose every database is unreadable shows `UnreadPage` instead.
 */
function ActivePage({
  target,
  context,
}: {
  readonly target: NavTarget;
  readonly context: CaseContext;
}) {
  const { profiles } = context;
  const scope = coverageOf(context.completeness, coverageScopeOf(target));
  if (
    target.config !== null &&
    target.timeline !== true &&
    target.sites !== true &&
    scope.unavailable > 0 &&
    scope.produced === 0
  ) {
    return <UnreadPage target={target} />;
  }
  if (target.timeline === true) {
    return <TimelinePage />;
  }
  if (target.sites === true) {
    return <SitesPage />;
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

/** The page's h1, made a programmatic focus target. */
function headingIn(column: HTMLElement | null): HTMLElement | null {
  const heading = column?.querySelector<HTMLElement>("h1") ?? null;
  if (heading !== null && !heading.hasAttribute("tabindex")) {
    heading.setAttribute("tabindex", "-1");
    heading.classList.add("outline-none");
  }
  return heading;
}

/** Focus is somewhere a page change may take it from: nowhere, the nav,
 *  the topbar, or the drawer trigger - never a field the user is in. */
function focusIsFree(column: HTMLElement): boolean {
  const active = document.activeElement;
  return (
    active === null ||
    active === document.body ||
    !column.contains(active) ||
    active.matches("h1")
  );
}

/**
 * After a page change: focus the new page's h1 (waiting for it when the
 * page builds its own, e.g. the Overview masthead after its read). After a
 * pick in the phone drawer, the drawer hands focus back to its trigger as
 * it closes; for a moment that hand-back is redirected to the heading too,
 * so keyboard users continue from the page they opened.
 */
function focusPageHeading(
  column: HTMLElement,
  fromDrawer: boolean,
): () => void {
  const cleanups: (() => void)[] = [];
  const focus = () => {
    const heading = headingIn(column);
    if (heading === null || !focusIsFree(column)) {
      return heading !== null;
    }
    heading.focus({ preventScroll: true });
    return true;
  };
  if (!focus()) {
    const observer = new MutationObserver(() => {
      if (focus()) {
        observer.disconnect();
      }
    });
    observer.observe(column, { childList: true, subtree: true });
    const stop = setTimeout(() => {
      observer.disconnect();
    }, 5000);
    cleanups.push(() => {
      observer.disconnect();
      clearTimeout(stop);
    });
  }
  if (fromDrawer) {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('[data-sidebar="trigger"]') !== null
      ) {
        headingIn(column)?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("focusin", onFocusIn);
    const stop = setTimeout(() => {
      document.removeEventListener("focusin", onFocusIn);
    }, 1500);
    cleanups.push(() => {
      document.removeEventListener("focusin", onFocusIn);
      clearTimeout(stop);
    });
  }
  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

/** The polite live region's text, set so a repeat is announced again. A
 *  message waits while a modal (⌘K, a sheet) still hides the page from
 *  assistive tech, up to a second. */
function useAnnouncer(): readonly [string, (message: string) => void] {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((next: string) => {
    setMessage("");
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    const started = Date.now();
    const attempt = () => {
      const hidden =
        document.querySelector('[role="dialog"][data-state="open"]') !== null;
      if (hidden && Date.now() - started < 1000) {
        timer.current = setTimeout(attempt, 100);
        return;
      }
      setMessage(next);
    };
    // A beat after the clear, so the same words are read again.
    timer.current = setTimeout(attempt, 150);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );
  return [message, announce] as const;
}

/** The topbar's ⌘K trigger: "Jump to" with its caps (icon only on a phone). */
function JumpToButton({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <Button
      variant="ghost"
      size="compact"
      leadingIcon={SearchIcon}
      onClick={onOpen}
      aria-label="Jump to a page, host or day"
      aria-keyshortcuts="Meta+K Control+K"
      className="shrink-0 text-muted-foreground"
    >
      <span className="max-sm:sr-only">Jump to</span>
      <CommandMenuShortcut keys="mod+k" className="ml-1 max-sm:hidden" />
    </Button>
  );
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
 * The open page comes from the URL (`useViewLocation`); a nav pick, an
 * Overview jump link, a Related link or ⌘K all move the URL, so Back and
 * Forward walk the same history.
 *
 * The content column is one `reveal-product` container keyed by the page, so
 * each page fades in (header first, then the body) when it opens. The column
 * re-provides surface level 2 — the inset's own level — so Panels land on
 * surface 3 and popups walk up the ladder from there.
 */
export function App() {
  const location = useViewLocation();
  const active = targetOf(location.page);
  const caseContext = useCaseContextRead();
  const { context, error, retry } = caseContext;
  const columnRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [announcement, announce] = useAnnouncer();
  const lensSummary = useLensSummary();
  // Set by a drawer pick, read by the page-change focus below.
  const fromDrawer = useRef(false);

  // An unknown or malformed hash shows what it parsed to.
  useEffect(() => {
    canonicalizeLocation();
  }, []);

  useGlobalRowKeys(columnRef);

  const selectTarget = useCallback((target: NavTarget, drawer: boolean) => {
    fromDrawer.current = drawer;
    openPage(target.key);
  }, []);

  // The tab's title names the page (and a Sites host), like any app.
  const host = active.sites === true ? location.host : null;
  useEffect(() => {
    document.title = [host, active.label, "ForensiX"]
      .filter((part) => part !== null)
      .join(" · ");
  }, [active.label, host]);

  // A new page starts at the top, takes focus on its h1 and is announced.
  // The first page of a visit only scrolls: focus stays where a fresh load
  // puts it.
  const firstPage = useRef(true);
  useEffect(() => {
    globalThis.scrollTo({ top: 0 });
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    const drawer = fromDrawer.current;
    fromDrawer.current = false;
    announce(active.label);
    const column = columnRef.current;
    return column === null ? undefined : focusPageHeading(column, drawer);
  }, [active.key, active.label, announce]);

  const clearedLens = useCallback(() => {
    announce("Showing every day and every profile");
    headingIn(columnRef.current)?.focus({ preventScroll: true });
  }, [announce]);

  // Evidence coverage for the page on show (forensic rule 1): the indicator
  // for its title row and the banner for under it. Overview's scope is the
  // whole Case.
  const coverageIndicator =
    context === null ? null : (
      <CoverageIndicator
        completeness={context.completeness}
        artifacts={coverageScopeOf(active)}
      />
    );
  const coverageBanner =
    context === null ? null : (
      <CoverageBanner
        completeness={context.completeness}
        artifacts={coverageScopeOf(active)}
      />
    );

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
                {/* Below `sm` the page's own h1 names the page right under
                    the bar, so the trail gives its room to the lens chip. */}
                <nav
                  aria-label="Breadcrumb"
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 max-sm:hidden",
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
                <div className="ml-auto flex min-w-0 items-center gap-1">
                  <ViewLensChip onClear={clearedLens} />
                  <JumpToButton
                    onOpen={() => {
                      setMenuOpen(true);
                    }}
                  />
                </div>
              </SidebarInsetTopbar>
            </div>
            <div role="status" aria-live="polite" className="sr-only">
              {announcement === ""
                ? ""
                : lensSummary === null
                  ? announcement
                  : `${announcement} - ${lensSummary}`}
            </div>
            <CaseCommandMenu
              open={menuOpen}
              onOpenChange={setMenuOpen}
              scope={columnRef}
            />
            <CaseContextProvider value={caseContext}>
              <SurfaceProvider value={2}>
                <div
                  key={active.key}
                  ref={columnRef}
                  className="reveal-product mx-auto flex w-full max-w-[1360px] min-w-0 flex-col gap-5 px-4 pb-10 md:px-8"
                >
                  {/* Overview builds its own masthead as its first block; the
                    shell still owns its coverage (the whole Case): a quiet
                    indicator at the right of the masthead and no banner —
                    the landing page stays calm; every evidence page keeps
                    its banner when degraded. */}
                  {active.key === "overview" ? null : (
                    <PageHeader
                      title={active.label}
                      aside={coverageIndicator}
                    />
                  )}
                  {active.key === "overview" ? null : coverageBanner}
                  <RowLookupNotice />
                  {active.key === "overview" ? (
                    <OverviewPage
                      coverage={
                        context === null ? null : (
                          <CoverageIndicator
                            completeness={context.completeness}
                            quiet
                          />
                        )
                      }
                    />
                  ) : error !== null ? (
                    <ErrorRows
                      message={error}
                      onRetry={retry}
                      className="px-0"
                    />
                  ) : context === null ? (
                    <LoadingRows className="px-0" />
                  ) : (
                    <ActivePage target={active} context={context} />
                  )}
                </div>
              </SurfaceProvider>
            </CaseContextProvider>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </FluidProvider>
  );
}
