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
  type RefObject,
} from "react";

import logoMark from "./assets/forensix-logo.png";
import { artifactStoreOf } from "./artifacts.js";
import { CaseCommandMenu, useCommandMenuState } from "./command-menu.js";
import {
  CoverageBanner,
  CoverageIndicator,
  coverageOf,
} from "./components/completeness.js";
import { EmptyRows } from "./components/data-table.js";
import { ErrorRows, LoadingRows } from "./components/list-states.js";
import { Panel } from "./components/panel.js";
import { RowLookupNotice } from "./components/row-lookup-notice.js";
import { SidebarInsetTopbar } from "./components/sidebar-app/inset-topbar.js";
import {
  SidebarWorkspaceHeader,
  WorkspaceTile,
} from "./components/sidebar-app/workspace-header.js";
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
import {
  focusPageHeading,
  pageHeading,
  rescueFocusFromCollapsedSidebar,
} from "./focus.js";
import { ARTIFACT_ICONS, SearchIcon } from "./lib/app-icons.js";
import { FluidProvider } from "./lib/fluid-provider.js";
import { fontWeights } from "./lib/font-weight.js";
import { untitleduiIcons } from "./lib/icons-untitledui.js";
import { typeClass } from "./lib/size-context.js";
import { SurfaceProvider } from "./lib/surface-context.js";
import { cn } from "./lib/utils.js";
import { PAGE_COMPONENTS } from "./page-views.js";
import { PAGE_KEYS, PAGES, type PageGroup, type PageKey } from "./pages.js";
import { useGlobalRowKeys, useSidebarKey } from "./shortcuts.js";
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

/**
 * Three groups, named by what the pages under them are, not by where they
 * sit: "Case" states conclusions about the evidence, "Views" regroup it,
 * "Evidence" is the evidence - the split that lets the evidence tables read
 * as one set instead of peers of the Overview. Rows follow the registry's
 * order (`PAGE_KEYS`, which ⌘K lists too). Icons (`ARTIFACT_ICONS`) are
 * picked for what each record type *is*; they follow the FF sidebar rows:
 * muted at rest, foreground and a heavier stroke on the active or hovered
 * row.
 */
const NAV_GROUPS: readonly {
  readonly label: PageGroup;
  readonly keys: readonly PageKey[];
}[] = (["Case", "Views", "Evidence"] as const).map((label) => ({
  label,
  keys: PAGE_KEYS.filter((key) => PAGES[key].group === label),
}));

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
  readonly activeKey: PageKey;
  /** `fromDrawer`: picked in the phone drawer, which closes on the pick. */
  readonly onSelect: (key: PageKey, fromDrawer: boolean) => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    // A landmark (axe `region`): the sidebar is the app's navigation.
    <Sidebar variant="inset" role="navigation" aria-label="Case sections">
      <SidebarHeader>
        <SidebarWorkspaceHeader name="ForensiX" tile={<BrandTile />} />
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            {/* role="list": FF draws its hover and selection fills as
                divs inside the ul; the explicit role keeps it a list. */}
            <SidebarMenu role="list" aria-label={group.label}>
              {group.keys.map((key) => (
                <SidebarMenuItem key={key}>
                  <SidebarMenuButton
                    icon={ARTIFACT_ICONS[key]}
                    isActive={key === activeKey}
                    aria-current={key === activeKey ? "page" : undefined}
                    onClick={() => {
                      onSelect(key, isMobile);
                      if (isMobile) {
                        setOpenMobile(false);
                      }
                    }}
                  >
                    {PAGES[key].label}
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
function UnreadPage({ page }: { readonly page: PageKey }) {
  const { label, artifact } = PAGES[page];
  return (
    <Panel>
      <EmptyRows
        icon={ARTIFACT_ICONS[page]}
        message={`No rows to show: no ${label} ${
          artifact === null
            ? "database"
            : artifactStoreOf(artifact.completenessArtifact)
        } could be read.`}
      />
    </Panel>
  );
}

/**
 * The page for a key. Evidence coverage is the shell's: the page's
 * indicator sits in its title row and, when something was not read, a
 * banner sits above the page (forensic rule 1). A single-artifact page
 * whose every database is unreadable shows `UnreadPage` instead.
 */
function ActivePage({
  page,
  context,
}: {
  readonly page: PageKey;
  readonly context: CaseContext;
}) {
  const { artifact, coverage } = PAGES[page];
  const scope = coverageOf(context.completeness, coverage ?? undefined);
  if (artifact !== null && scope.unavailable > 0 && scope.produced === 0) {
    return <UnreadPage page={page} />;
  }
  const Page = PAGE_COMPONENTS[page];
  return <Page />;
}

/** The polite live region's text, set so a repeat is announced again.
 *  Dialogs hand their announcements over once they have closed (⌘K runs a
 *  pick from its `onCloseAutoFocus`), so the region is never hidden from
 *  assistive tech when it speaks. */
function useAnnouncer(): readonly [string, (message: string) => void] {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((next: string) => {
    setMessage("");
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    // A beat after the clear, so the same words are read again.
    timer.current = setTimeout(() => {
      setMessage(next);
    }, 150);
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

/**
 * The shell's sidebar keys and focus: `[` toggles the sidebar from the page
 * itself only (`useSidebarKey`; FF's own app-wide binding is off), and when
 * a collapse hides the element that had focus (a nav row, the brand row's
 * trigger, a ⌘K pick made from the sidebar), focus moves to the topbar's
 * sidebar trigger instead of falling to <body>.
 */
function SidebarKeys({
  column,
}: {
  readonly column: RefObject<HTMLElement | null>;
}) {
  const { toggleSidebar } = useSidebar();
  useSidebarKey(column, toggleSidebar);
  useEffect(rescueFocusFromCollapsedSidebar, []);
  return null;
}

/** The topbar's ⌘K trigger: "Jump to" with its caps (icon only on a phone). */
function JumpToButton({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <Button
      variant="ghost"
      size="compact"
      leadingIcon={SearchIcon}
      onClick={onOpen}
      aria-label="Jump to a page, host, file, username or day"
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
 * press `[` from the page, or the topbar trigger; collapsed, it peeks back on hover) and a
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
  const page = location.page;
  const { label, group, coverage, ownHeader } = PAGES[page];
  const caseContext = useCaseContextRead();
  const { context, error, retry } = caseContext;
  const columnRef = useRef<HTMLDivElement>(null);
  const menu = useCommandMenuState();
  const [announcement, announce] = useAnnouncer();
  const lensSummary = useLensSummary();
  // Set by a drawer pick, read by the page-change focus below.
  const fromDrawer = useRef(false);

  // An unknown or malformed hash shows what it parsed to.
  useEffect(() => {
    canonicalizeLocation();
  }, []);

  useGlobalRowKeys(columnRef);

  const selectPage = useCallback((key: PageKey, drawer: boolean) => {
    fromDrawer.current = drawer;
    openPage(key);
  }, []);

  // The tab's title names the page (and a Sites host), like any app.
  const host = page === "sites" ? location.host : null;
  useEffect(() => {
    document.title = [host, label, "ForensiX"]
      .filter((part) => part !== null)
      .join(" · ");
  }, [label, host]);

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
    announce(label);
    const column = columnRef.current;
    return column === null ? undefined : focusPageHeading(column, drawer);
  }, [page, label, announce]);

  const clearedLens = useCallback(
    (message: string) => {
      announce(message);
      pageHeading(columnRef.current)?.focus({ preventScroll: true });
    },
    [announce],
  );

  // Evidence coverage for the page on show (forensic rule 1): the indicator
  // for its title row and the banner for under it. A page with its own
  // masthead (Overview) reads the Case context itself - its loading, its
  // failure, its quiet whole-Case indicator - and carries no banner.
  const scope = coverage ?? undefined;
  const OwnHeaderPage = PAGE_COMPONENTS[page];

  return (
    <FluidProvider icons={untitleduiIcons}>
      <TooltipProvider delayDuration={150}>
        <SidebarProvider persist={false} peek="hover" shortcut={null}>
          <SidebarKeys column={columnRef} />
          <CaseSidebar activeKey={page} onSelect={selectPage} />
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
                    {group}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    /
                  </span>
                  <span
                    aria-current="page"
                    className="truncate text-foreground"
                  >
                    {label}
                  </span>
                </nav>
                <div className="ml-auto flex min-w-0 items-center gap-1">
                  <ViewLensChip onClear={clearedLens} />
                  <JumpToButton
                    onOpen={() => {
                      menu.setOpen(true);
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
              state={menu}
              scope={columnRef}
              announce={announce}
            />
            <CaseContextProvider value={caseContext}>
              <SurfaceProvider value={2}>
                <div
                  key={page}
                  ref={columnRef}
                  data-page-column=""
                  className="reveal-product mx-auto flex w-full max-w-[1360px] min-w-0 flex-col gap-5 px-4 pb-10 md:px-8"
                >
                  {ownHeader === true ? null : (
                    <>
                      <PageHeader
                        title={label}
                        aside={
                          context === null ? null : (
                            <CoverageIndicator
                              completeness={context.completeness}
                              artifacts={scope}
                            />
                          )
                        }
                      />
                      {context === null ? null : (
                        <CoverageBanner
                          completeness={context.completeness}
                          artifacts={scope}
                        />
                      )}
                    </>
                  )}
                  <RowLookupNotice />
                  {ownHeader === true ? (
                    <OwnHeaderPage />
                  ) : error !== null ? (
                    <ErrorRows
                      message={error}
                      onRetry={retry}
                      className="px-0"
                    />
                  ) : context === null ? (
                    <LoadingRows className="px-0" />
                  ) : (
                    <ActivePage page={page} context={context} />
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
