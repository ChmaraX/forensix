/**
 * ⌘K: jump anywhere in the Case. FF's CommandMenuDialog (the installed
 * registry component, bound to mod+K), with:
 *
 *  - Pages: every nav section;
 *  - the Case index (once something is typed; rules in command-index.ts):
 *    Hosts (every host the Sites view lists, opening Sites on it), Files
 *    (download file names, opening that exact Downloads row), Usernames
 *    (saved-login usernames, opening that exact Saved logins row) and Days
 *    (every day with saved page visits, typed "12 Mar", "Mar 12" or
 *    "2024-03-12", opening the Timeline on it). Each group lists its first
 *    `INDEX_GROUP_CAP` matches, then "N more … match" (opening the page
 *    searched for the query where it has a search);
 *  - Recent days (no query): the latest days with saved page visits;
 *  - Theme: Light / System / Dark;
 *  - Shortcuts: the keys the dashboard answers, each with its caps - the
 *    one place they are listed (no how-to copy on the pages) - and the
 *    single-key shortcuts switch (J, K and [).
 *
 * The index reads (hosts, activity, downloads, saved logins) start the
 * first time the menu opens, each once per session. Closing the menu
 * without a pick returns focus to where it was (a row, the trigger).
 *
 * Read-only: every row navigates or changes presentation, nothing else.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
  defaultCommandMenuFilter,
  type CommandMenuItemData,
} from "@/components/ui/command-menu";
import { useSidebar } from "@/components/ui/sidebar";
import {
  ARTIFACT_ICONS,
  CalendarIcon,
  DarkThemeIcon,
  DownloadedFileIcon,
  LightThemeIcon,
  SystemThemeIcon,
  KeyboardIcon,
  UserIcon,
  type AppIcon,
} from "@/lib/app-icons";
import {
  caseActivity,
  caseDownloads,
  caseSavedLogins,
  caseSiteHosts,
} from "./case-reads.js";
import {
  capMatches,
  dayKeywords,
  entryDescription,
  fileEntriesOf,
  moreLabel,
  usernameEntriesOf,
  type FileEntry,
  type UsernameEntry,
} from "./command-index.js";
import { bucketsToDays } from "./components/activity-data.js";
import { formatCaseDay } from "./related.js";
import { PAGES } from "./router.js";
import {
  moveRowFocus,
  setSingleKeyShortcuts,
  SHORTCUTS,
  useSingleKeyShortcuts,
} from "./shortcuts.js";
import { chooseTheme } from "./theme.js";
import type { SiteArtifactKind, SiteHost } from "./types.js";
import { openPage } from "./view-state.js";

/** Days listed under "Recent days" (no query). */
const RECENT_DAYS = 7;

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

/** Rows the menu lists as they are (already matched by the index, or a
 *  group's "N more" row); every other row goes through FF's filter. */
const PREMATCHED = /^(host|file|user|day|more|pending):/;

function menuFilter(item: CommandMenuItemData, query: string): boolean {
  return PREMATCHED.test(item.value) || defaultCommandMenuFilter(item, query);
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
  /** Every day with saved page visits, newest first. */
  readonly days: readonly { readonly date: string; readonly count: number }[];
  readonly files: readonly FileEntry[];
  readonly usernames: readonly UsernameEntry[];
  /** Index reads still in flight. */
  readonly pending: number;
}

/** The Case reads the menu indexes, made the first time it opens (each
 *  read is shared and made once per session, case-reads.ts). */
function useMenuData(open: boolean): Loaded {
  const [hosts, setHosts] = useState<readonly SiteHost[]>([]);
  const [days, setDays] = useState<Loaded["days"]>([]);
  const [files, setFiles] = useState<readonly FileEntry[]>([]);
  const [usernames, setUsernames] = useState<readonly UsernameEntry[]>([]);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    const reads: Promise<unknown>[] = [
      caseSiteHosts().then((result) => {
        if (!cancelled) {
          setHosts(result.hosts);
        }
      }),
      caseActivity().then((activity) => {
        if (!cancelled) {
          setDays(
            bucketsToDays(activity.saved)
              .filter((day) => day.count > 0)
              .reverse(),
          );
        }
      }),
      caseDownloads().then((result) => {
        if (!cancelled) {
          setFiles(fileEntriesOf(result.rows));
        }
      }),
      caseSavedLogins().then((result) => {
        if (!cancelled) {
          setUsernames(usernameEntriesOf(result.rows));
        }
      }),
    ];
    setPending(reads.length);
    for (const read of reads) {
      read
        .catch(() => {
          // The menu still jumps to pages; the page names the failure.
          // A failed read is retried the next time the menu opens; a
          // finished one answers at once from its session cache.
        })
        .finally(() => {
          if (!cancelled) {
            setPending((count) => count - 1);
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [open]);
  return { hosts, days, files, usernames, pending };
}

/** The element focus should return to after the menu closes: what had it
 *  when the menu opened, if it is still on show; else the page's h1. */
function returnTarget(
  previous: HTMLElement | null,
  column: HTMLElement | null,
): HTMLElement | null {
  if (
    previous !== null &&
    previous.isConnected &&
    previous.getClientRects().length > 0
  ) {
    return previous;
  }
  const heading = column?.querySelector<HTMLElement>("h1") ?? null;
  if (heading !== null && !heading.hasAttribute("tabindex")) {
    heading.setAttribute("tabindex", "-1");
    heading.classList.add("outline-none");
  }
  return heading;
}

/**
 * The ⌘K dialog. Mount once inside the shell's SidebarProvider; `open` is
 * controlled so the topbar's trigger can open it too. `scope` is the page
 * column, for the row shortcuts and the focus fallback; `announce` is the
 * shell's polite region (read once the dialog has closed).
 */
export function CaseCommandMenu({
  open,
  onOpenChange,
  scope,
  announce,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly scope: RefObject<HTMLElement | null>;
  readonly announce: (message: string) => void;
}) {
  const { toggleSidebar } = useSidebar();
  const [query, setQuery] = useState("");
  const { hosts, days, files, usernames, pending } = useMenuData(open);
  const singleKeys = useSingleKeyShortcuts();

  // Where focus was when the menu opened (a row, the trigger), recorded
  // before the dialog moves it, so a close without a pick goes back there.
  const returnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement;
      returnTo.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
    }
  }, [open]);

  const restoreFocus = useCallback(() => {
    const previous = returnTo.current;
    returnTo.current = null;
    afterDialogCloses(() => {
      const active = document.activeElement;
      // A pick that moved focus (a page's h1, a row) keeps it.
      if (active !== null && active !== document.body) {
        return;
      }
      returnTarget(previous, scope.current)?.focus({ preventScroll: true });
    });
  }, [scope]);

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

  // Stable apart from the index rows: the highlight resets only when the
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
    const singleKeyRow: CommandMenuItemData = {
      value: "shortcut-single-keys",
      label: `Single-key shortcuts: ${singleKeys ? "on" : "off"}`,
      description: "J, K and [",
      action: singleKeys ? "Turn off" : "Turn on",
      icon: KeyboardIcon,
      keywords: ["shortcut", "keyboard", "key", "single", "j", "k"],
      group: "Shortcuts",
      onSelect: () => {
        setSingleKeyShortcuts(!singleKeys);
        announce(
          singleKeys
            ? "Single-key shortcuts off. J, K and [ do nothing."
            : "Single-key shortcuts on.",
        );
      },
    };
    return [...pages, ...themes, ...shortcuts, singleKeyRow];
  }, [announce, focusRow, singleKeys, toggleSidebar]);

  // Recent days while nothing is typed.
  const recentRows = useMemo<readonly CommandMenuItemData[]>(
    () =>
      days.slice(0, RECENT_DAYS).map((day) => ({
        value: `recent:${day.date}`,
        label: formatCaseDay(day.date),
        description: `${day.count.toLocaleString("en-US")} saved page ${day.count === 1 ? "visit" : "visits"}`,
        action: "Open in Timeline",
        icon: CalendarIcon,
        group: "Recent days",
        onSelect: () => {
          openPage("timeline", { from: day.date, to: day.date });
        },
      })),
    [days],
  );

  // The Case index, once a query narrows it: a Case can hold thousands of
  // hosts, files and days.
  const trimmed = query.trim();
  const indexRows = useMemo<readonly CommandMenuItemData[]>(() => {
    if (trimmed === "") {
      return [];
    }
    const rows: CommandMenuItemData[] = [];
    const hostMatch = capMatches(hosts, trimmed, (host) => [host.host]);
    for (const host of hostMatch.shown) {
      rows.push({
        value: `host:${host.host}`,
        label: host.host,
        description: hostSummary(host),
        action: "Open in Sites",
        icon: ARTIFACT_ICONS.sites,
        group: "Hosts",
        onSelect: () => {
          openPage("sites", { host: host.host });
        },
      });
    }
    if (hostMatch.more > 0) {
      rows.push({
        value: "more:hosts",
        label: moreLabel(hostMatch.more, "host", "hosts"),
        action: "Open Sites searched for this",
        icon: ARTIFACT_ICONS.sites,
        group: "Hosts",
        onSelect: () => {
          openPage("sites", { q: trimmed });
        },
      });
    }
    const fileMatch = capMatches(files, trimmed, (file) => [
      file.name,
      file.host ?? "",
    ]);
    for (const file of fileMatch.shown) {
      rows.push({
        value: `file:${file.ref}`,
        label: file.name,
        description: entryDescription(file.host, file.profile, file.recovered),
        action: "Open this download",
        icon: DownloadedFileIcon,
        group: "Files",
        onSelect: () => {
          openPage("downloads", {
            row: file.ref,
            tab: file.recovered ? "recovered" : "saved",
          });
        },
      });
    }
    if (fileMatch.more > 0) {
      rows.push({
        value: "more:files",
        label: moreLabel(fileMatch.more, "file", "files"),
        action: "Open Downloads searched for this",
        icon: ARTIFACT_ICONS.downloads,
        group: "Files",
        onSelect: () => {
          openPage("downloads", { q: trimmed });
        },
      });
    }
    const userMatch = capMatches(usernames, trimmed, (entry) => [
      entry.username,
      entry.site ?? "",
    ]);
    for (const entry of userMatch.shown) {
      rows.push({
        value: `user:${entry.ref}`,
        label: entry.username,
        description: entryDescription(
          entry.site,
          entry.profile,
          entry.recovered,
        ),
        action: "Open this saved login",
        icon: UserIcon,
        group: "Usernames",
        onSelect: () => {
          openPage("credentials", {
            row: entry.ref,
            tab: entry.recovered ? "recovered" : "saved",
          });
        },
      });
    }
    if (userMatch.more > 0) {
      rows.push({
        value: "more:usernames",
        label: moreLabel(userMatch.more, "username", "usernames"),
        action: "Open Saved logins searched for this",
        icon: ARTIFACT_ICONS.credentials,
        group: "Usernames",
        onSelect: () => {
          openPage("credentials", { q: trimmed });
        },
      });
    }
    const dayMatch = capMatches(days, trimmed, (day) => dayKeywords(day.date));
    for (const day of dayMatch.shown) {
      rows.push({
        value: `day:${day.date}`,
        label: formatCaseDay(day.date),
        description: `${day.count.toLocaleString("en-US")} saved page ${day.count === 1 ? "visit" : "visits"}`,
        action: "Open in Timeline",
        icon: CalendarIcon,
        group: "Days",
        onSelect: () => {
          openPage("timeline", { from: day.date, to: day.date });
        },
      });
    }
    if (dayMatch.more > 0) {
      rows.push({
        value: "more:days",
        label: moreLabel(dayMatch.more, "day", "days"),
        description: "Type more of the date to narrow",
        icon: CalendarIcon,
        group: "Days",
        disabled: true,
      });
    }
    if (pending > 0) {
      rows.push({
        value: "pending:index",
        label: "Still reading the Case",
        description: "More hosts, files, usernames and days may appear",
        group: "Searching",
        disabled: true,
      });
    }
    return rows;
  }, [days, files, hosts, pending, trimmed, usernames]);

  const items = useMemo(() => {
    const pages = fixed.filter((item) => item.group === "Pages");
    const rest = fixed.filter((item) => item.group !== "Pages");
    return trimmed === ""
      ? [...pages, ...recentRows, ...rest]
      : [...pages, ...indexRows, ...rest];
  }, [fixed, indexRows, recentRows, trimmed]);

  // The words for a query nothing matches, written into an always-mounted
  // polite region (FF's own empty row mounts with its text, which screen
  // readers may skip).
  const nothing =
    trimmed !== "" && !items.some((item) => menuFilter(item, query));
  const emptyWords = `No page, host, file, username or day matches "${trimmed}".`;

  return (
    <CommandMenuDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
          restoreFocus();
        }
        onOpenChange(next);
      }}
      title="Jump to"
      description="Search pages, hosts, files, usernames and days of this Case."
    >
      <CommandMenu
        items={items}
        query={query}
        onQueryChange={setQuery}
        filter={menuFilter}
      >
        <CommandMenuInput
          aria-label="Jump to"
          placeholder="Jump to a page, host, file, username or day…"
        />
        <CommandMenuList>
          <CommandMenuEmpty role="none" aria-live="off">
            {emptyWords}
          </CommandMenuEmpty>
        </CommandMenuList>
        <div role="status" aria-live="polite" className="sr-only">
          {nothing ? emptyWords : ""}
        </div>
        <CommandMenuFooter />
      </CommandMenu>
    </CommandMenuDialog>
  );
}
