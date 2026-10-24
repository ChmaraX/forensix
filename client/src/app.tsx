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
  ListOrdered,
  Image as SiteImageIcon,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { callApi } from "./api.js";
import logoMark from "./assets/forensix-logo.png";
import { ARTIFACTS } from "./artifacts.js";
import { ArtifactPage } from "./components/artifact-page.js";
import { AutofillPage } from "./components/autofill-page.js";
import { BookmarksPage } from "./components/bookmarks-page.js";
import { CachePage } from "./components/cache-page.js";
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
import { FluidProvider } from "./lib/fluid-provider.js";
import { fontWeights } from "./lib/font-weight.js";
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
  readonly icon: LucideIcon;
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
 * Icons are picked for what each record type *is*, not for decoration: Top
 * sites is ranking (`TrendingUp`), the Sites view is host identity (`Globe`),
 * Bookmarks is the saved-page glyph, Favicons is the image glyph — the four
 * that used to collapse into one repeated "site" mark now read apart at a
 * glance. Icons follow the FF sidebar rows: muted at rest, foreground and a
 * heavier stroke on the active or hovered row.
 */
const NAV_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
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

/** Page title and one-line description, on the display and body roles. */
function PageHeader({ target }: { readonly target: NavTarget }) {
  const description =
    target.timeline === true
      ? "Recorded browser events in chronological order, without inference."
      : target.sites === true
        ? "Recorded host keys grouped from browser evidence, without inference."
        : target.config?.description;
  return (
    <header className="flex flex-col gap-1 pt-2">
      <h1
        className={cn(typeClass("display"), "text-foreground")}
        style={{ fontVariationSettings: fontWeights.bold }}
      >
        {target.label}
      </h1>
      {description === undefined ? null : (
        <p
          className={cn(
            typeClass("body"),
            "max-w-[68ch] text-muted-foreground",
          )}
        >
          {description}
        </p>
      )}
    </header>
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
    <FluidProvider>
      <TooltipProvider delayDuration={150}>
        <SidebarProvider persist={false} peek="hover">
          <CaseSidebar activeKey={active.key} onSelect={selectTarget} />
          {/* Below the drawer breakpoint the rail is gone; keep the inset card
              off the left edge as it is off the right. */}
          <SidebarInset className="max-md:ml-2!">
            <SidebarInsetTopbar className="sticky top-0 z-30 px-2">
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
                <span aria-current="page" className="truncate text-foreground">
                  {active.label}
                </span>
              </nav>
            </SidebarInsetTopbar>
            <SurfaceProvider value={2}>
              <div
                key={active.key}
                className="reveal-product mx-auto flex w-full max-w-[1360px] min-w-0 flex-col gap-5 px-4 pb-10 md:px-8"
              >
                {/* Overview builds its own masthead as its first block. */}
                {active.key === "overview" ? null : (
                  <PageHeader target={active} />
                )}
                {active.timeline === true ? (
                  <TimelinePage />
                ) : active.sites === true ? (
                  <SitesPage initialHost={sitesPreselect} />
                ) : active.config === null ? (
                  <OverviewPage onOpen={openSection} />
                ) : error !== null ? (
                  <ErrorRows message={error} onRetry={retry} className="px-0" />
                ) : context === null ? (
                  <LoadingRows className="px-0" />
                ) : active.config.key === "history" ? (
                  <HistoryPage profiles={context.profiles} />
                ) : active.config.key === "top-sites" ? (
                  <TopSitesPage config={active.config} />
                ) : active.config.key === "downloads" ? (
                  <DownloadsPage config={active.config} />
                ) : active.config.key === "bookmarks" ? (
                  <BookmarksPage config={active.config} />
                ) : active.config.key === "cookies" ? (
                  <CookiesPage config={active.config} />
                ) : active.config.key === "favicons" ? (
                  <FaviconsPage config={active.config} />
                ) : active.config.key === "metadata" ? (
                  <MetadataPage config={active.config} />
                ) : active.config.key === "autofill" ? (
                  <AutofillPage config={active.config} />
                ) : active.config.key === "credentials" ? (
                  <CredentialsPage config={active.config} />
                ) : active.config.key === "cache" ? (
                  <CachePage config={active.config} />
                ) : (
                  <ArtifactPage
                    config={active.config}
                    completeness={context.completeness}
                    profiles={context.profiles}
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
