/**
 * ⌘K: jump anywhere in the Case. FF's CommandMenuDialog (the installed
 * registry component, bound to mod+K), with:
 *
 *  - Pages: every nav section;
 *  - Hosts (once something is typed): every host the Sites view lists,
 *    opening Sites on that host;
 *  - Recent days: the latest days with saved page visits, opening the
 *    Timeline on that day (the Case-wide range);
 *  - Theme: Light / System / Dark;
 *  - Shortcuts: the keys the dashboard answers, each with its caps - the
 *    one place they are listed (no how-to copy on the pages).
 *
 * Read-only: every row navigates or changes presentation, nothing else.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";

import {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuInput,
  CommandMenuList,
  type CommandMenuItemData,
} from "@/components/ui/command-menu";
import { useSidebar } from "@/components/ui/sidebar";
import {
  ARTIFACT_ICONS,
  CalendarIcon,
  DarkThemeIcon,
  LightThemeIcon,
  SystemThemeIcon,
  KeyboardIcon,
  type AppIcon,
} from "@/lib/app-icons";
import { caseActivity, caseSiteHosts } from "./case-reads.js";
import { bucketsToDays } from "./components/activity-data.js";
import { formatCaseDay } from "./related.js";
import { PAGES } from "./router.js";
import { moveRowFocus, SHORTCUTS } from "./shortcuts.js";
import { chooseTheme } from "./theme.js";
import type { SiteArtifactKind, SiteHost } from "./types.js";
import { openPage } from "./view-state.js";

/** Days listed under "Recent days". */
const RECENT_DAYS = 7;
/** Host rows listed for one query (the rest narrow as it grows). */
const HOST_ROWS = 50;

const HOST_KIND_WORDS: readonly (readonly [
  SiteArtifactKind,
  string,
  string,
])[] = [
  ["visits", "visit", "visits"],
  ["saved_logins", "saved login", "saved logins"],
  ["cookies", "cookie", "cookies"],
  ["bookmarks", "bookmark", "bookmarks"],
  ["top_sites", "top site", "top sites"],
  ["form_data", "form entry", "form entries"],
];

/** "3 visits · 1 cookie": the host's saved rows, as the Sites list counts. */
function hostSummary(host: SiteHost): string {
  return HOST_KIND_WORDS.flatMap(([kind, one, many]) => {
    const count = host.savedCounts[kind] ?? 0;
    return count === 0
      ? []
      : [`${count.toLocaleString("en-US")} ${count === 1 ? one : many}`];
  }).join(" · ");
}

/** Runs `action` once the dialog has closed and handed focus back, so the
 *  focus it moves is not taken over by the dialog's focus restore. */
function afterDialogCloses(action: () => void): void {
  const started = performance.now();
  const step = () => {
    const open =
      document.querySelector('[data-slot="command-menu-input"]') !== null ||
      document.querySelector('[role="dialog"][data-state="open"]') !== null;
    if (open && performance.now() - started < 1500) {
      requestAnimationFrame(step);
      return;
    }
    // Past the dialog's own focus restore (Radix runs it on a 0ms timer).
    setTimeout(action, 50);
  };
  requestAnimationFrame(step);
}

interface Loaded {
  readonly hosts: readonly SiteHost[];
  readonly days: readonly { readonly date: string; readonly count: number }[];
}

/** The two Case reads the menu lists, made the first time it opens. */
function useMenuData(open: boolean): Loaded {
  const [hosts, setHosts] = useState<readonly SiteHost[]>([]);
  const [days, setDays] = useState<Loaded["days"]>([]);
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    caseSiteHosts()
      .then((result) => {
        if (!cancelled) {
          setHosts(result.hosts);
        }
      })
      .catch(() => {
        // The menu still jumps to pages; the Sites page names the failure.
      });
    caseActivity()
      .then((activity) => {
        if (!cancelled) {
          setDays(bucketsToDays(activity.saved).slice(-RECENT_DAYS).reverse());
        }
      })
      .catch(() => {
        // As above: the History page names an activity failure.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);
  return { hosts, days };
}

/**
 * The ⌘K dialog. Mount once inside the shell's SidebarProvider; `open` is
 * controlled so the topbar's trigger can open it too. `scope` is the page
 * column, for the row shortcuts.
 */
export function CaseCommandMenu({
  open,
  onOpenChange,
  scope,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly scope: RefObject<HTMLElement | null>;
}) {
  const { toggleSidebar } = useSidebar();
  const [query, setQuery] = useState("");
  const { hosts, days } = useMenuData(open);

  const focusRow = useCallback(
    (delta: 1 | -1) => {
      afterDialogCloses(() => {
        const column = scope.current;
        if (column !== null) {
          moveRowFocus(null, delta, column);
        }
      });
    },
    [scope],
  );

  // Stable apart from the host rows: the highlight resets only when the
  // rows on show change.
  const fixed = useMemo<readonly CommandMenuItemData[]>(() => {
    const pages = PAGES.map((page) => ({
      value: `page:${page.key}`,
      label: page.label,
      action: `Open ${page.label}`,
      icon: (ARTIFACT_ICONS as Readonly<Record<string, AppIcon>>)[page.key],
      group: "Pages",
      onSelect: () => {
        openPage(page.key);
      },
    }));
    const recent = days.map((day) => ({
      value: `day:${day.date}`,
      label: formatCaseDay(day.date),
      description: `${day.count.toLocaleString("en-US")} saved page ${day.count === 1 ? "visit" : "visits"}`,
      action: "Open in Timeline",
      icon: CalendarIcon,
      keywords: [day.date],
      group: "Recent days",
      onSelect: () => {
        openPage("timeline", { from: day.date, to: day.date });
      },
    }));
    const themes = (
      [
        ["light", "Light theme", LightThemeIcon],
        ["system", "Match system theme", SystemThemeIcon],
        ["dark", "Dark theme", DarkThemeIcon],
      ] as const
    ).map(([preference, label, icon]) => ({
      value: `theme:${preference}`,
      label,
      action: "Switch",
      icon,
      keywords: ["theme", "appearance", preference],
      group: "Theme",
      onSelect: () => {
        chooseTheme(preference);
      },
    }));
    const shortcutAction: Readonly<Record<string, () => void>> = {
      "shortcut-next": () => {
        focusRow(1);
      },
      "shortcut-previous": () => {
        focusRow(-1);
      },
      "shortcut-sidebar": () => {
        afterDialogCloses(toggleSidebar);
      },
    };
    const shortcuts = SHORTCUTS.map((shortcut) => {
      const run = shortcutAction[shortcut.value];
      return {
        value: shortcut.value,
        label: shortcut.label,
        shortcut: shortcut.keys,
        icon: KeyboardIcon,
        keywords: ["shortcut", "keyboard", "key"],
        group: "Shortcuts",
        // A shortcut that has something to do from here does it; the rest
        // are listed for their keys and simply close the menu.
        action:
          run === undefined
            ? "Close"
            : shortcut.value === "shortcut-sidebar"
              ? "Show or hide the sidebar"
              : shortcut.value === "shortcut-next"
                ? "Go to the first row"
                : "Go to the last row",
        onSelect: run,
      };
    });
    return [...pages, ...recent, ...themes, ...shortcuts];
  }, [days, focusRow, toggleSidebar]);

  // Hosts only once a query narrows them: a Case can hold thousands.
  const needle = query.trim().toLowerCase();
  const hostRows = useMemo<readonly CommandMenuItemData[]>(() => {
    if (needle === "") {
      return [];
    }
    return hosts
      .filter((host) => host.host.includes(needle))
      .slice(0, HOST_ROWS)
      .map((host) => ({
        value: `host:${host.host}`,
        label: host.host,
        description: hostSummary(host),
        action: "Open in Sites",
        icon: ARTIFACT_ICONS.sites,
        group: "Hosts",
        onSelect: () => {
          openPage("sites", { host: host.host });
        },
      }));
  }, [hosts, needle]);

  const items = useMemo(() => {
    const pages = fixed.filter((item) => item.group === "Pages");
    const rest = fixed.filter((item) => item.group !== "Pages");
    return [...pages, ...hostRows, ...rest];
  }, [fixed, hostRows]);

  return (
    <CommandMenuDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
        }
        onOpenChange(next);
      }}
      title="Jump to"
      description="Search pages, hosts and days of this Case."
    >
      <CommandMenu items={items} query={query} onQueryChange={setQuery}>
        <CommandMenuInput placeholder="Jump to a page, host or day…" />
        <CommandMenuList>
          <CommandMenuEmpty>
            No page, host or day matches "{query.trim()}".
          </CommandMenuEmpty>
        </CommandMenuList>
        <CommandMenuFooter />
      </CommandMenu>
    </CommandMenuDialog>
  );
}
