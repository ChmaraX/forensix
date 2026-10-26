/**
 * ⌘K: jump anywhere in the Case. FF's CommandMenu in FF's Dialog (the
 * composition FF's CommandMenuDialog makes, bound to mod+K here), so the
 * dialog's own `onCloseAutoFocus` decides where focus goes. With:
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
 * first time the menu opens, each once per session.
 *
 * Focus: a pick runs once the dialog has closed (from its
 * `onCloseAutoFocus`), so the focus it moves (a page's h1, a row) and the
 * words it announces are never taken over by the dialog's own focus
 * restore or hidden by its modal. Closing without a pick returns focus to
 * where it was (a row, the trigger; else the page's h1). Each opening is a
 * fresh dialog, so a menu reopened while the last one is still leaving is
 * never left hidden from assistive tech by a sheet that opened meanwhile.
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
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuInput,
  CommandMenuList,
  defaultCommandMenuFilter,
  matchesShortcut,
  parseShortcut,
  type CommandMenuItemData,
} from "@/components/ui/command-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
} from "@/lib/app-icons";
import { caseDownloads, caseSavedLogins, caseSiteHosts } from "./case-reads.js";
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
import { bucketsToDays, caseActivity } from "./components/activity-data.js";
import { hostSummary } from "./components/site-kinds.js";
import { returnTarget } from "./focus.js";
import { setCommandMenuOpen } from "./menu-open.js";
import { PAGE_KEYS, PAGES } from "./pages.js";
import { formatDay } from "./day-format.js";
import {
  moveRowFocus,
  setSingleKeyShortcuts,
  SHORTCUTS,
  useSingleKeyShortcuts,
} from "./shortcuts.js";
import { chooseTheme } from "./theme.js";
import type { SiteHost } from "./types.js";
import { openPage } from "./view-state.js";

/** Days listed under "Recent days" (no query). */
const RECENT_DAYS = 7;

/** Rows the menu lists as they are (already matched by the index, or a
 *  group's "N more" row); every other row goes through FF's filter. */
const PREMATCHED = /^(host|file|user|day|more|pending):/;

function menuFilter(item: CommandMenuItemData, query: string): boolean {
  return PREMATCHED.test(item.value) || defaultCommandMenuFilter(item, query);
}

/** The combo that opens and closes the menu from anywhere. */
const MENU_SHORTCUT = parseShortcut("mod+k");

/** The menu's open state, a count of openings (each opening mounts a
 *  fresh dialog: `generation` keys it) and the pick waiting for the dialog
 *  to close. */
export interface CommandMenuState {
  readonly open: boolean;
  readonly generation: number;
  readonly setOpen: (open: boolean) => void;
  /** The picked row's action, run once the dialog has closed - or, when
   *  the menu is opened again before that, first. */
  readonly pending: RefObject<(() => void) | null>;
}

export function useCommandMenuState(): CommandMenuState {
  const [state, setState] = useState({ open: false, generation: 0 });
  const pending = useRef<(() => void) | null>(null);
  const setOpen = useCallback((open: boolean) => {
    if (open) {
      // Reopened while the last pick still waits for its dialog to leave:
      // the pick happens first, so whatever it opens (a sheet) is under
      // the new menu, never over it.
      const run = pending.current;
      pending.current = null;
      run?.();
    }
    setState((current) =>
      current.open === open
        ? current
        : {
            open,
            generation: open ? current.generation + 1 : current.generation,
          },
    );
  }, []);
  // Shared with the row sheets, which do not open under the menu.
  useEffect(() => {
    setCommandMenuOpen(state.open);
  }, [state.open]);
  return { ...state, setOpen, pending };
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

/**
 * The ⌘K dialog. Mount once inside the shell's SidebarProvider; `state`
 * (`useCommandMenuState`) is the shell's, so the topbar's trigger opens it
 * too. `scope` is the page column, for the row shortcuts and the focus
 * fallback; `announce` is the shell's polite region (spoken once the
 * dialog has closed).
 */
export function CaseCommandMenu({
  state,
  scope,
  announce,
}: {
  readonly state: CommandMenuState;
  readonly scope: RefObject<HTMLElement | null>;
  readonly announce: (message: string) => void;
}) {
  const { open, generation, setOpen, pending: pick } = state;
  const { toggleSidebar } = useSidebar();
  const [query, setQuery] = useState("");
  const { hosts, days, files, usernames, pending } = useMenuData(open);
  const singleKeys = useSingleKeyShortcuts();

  // mod+K toggles the menu from anywhere, a field included.
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.defaultPrevented ||
        !matchesShortcut(event, MENU_SHORTCUT)
      ) {
        return;
      }
      event.preventDefault();
      setOpen(!openRef.current);
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [setOpen]);

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

  // The picked row's action runs once the dialog has closed.
  const afterClose = useCallback(
    (event: Event) => {
      // Focus is placed here, not by the dialog's own restore.
      event.preventDefault();
      const action = pick.current;
      const previous = returnTo.current;
      pick.current = null;
      returnTo.current = null;
      action?.();
      // Reopened meanwhile (this dialog left as a fresh one opened): the new
      // menu keeps focus. A pick that moved focus (a page's h1, a row, a
      // sheet) keeps it.
      const active = document.activeElement;
      if (openRef.current || (active !== null && active !== document.body)) {
        return;
      }
      returnTarget(previous, scope.current)?.focus({ preventScroll: true });
    },
    [pick, scope],
  );

  const focusRow = useCallback(
    (delta: 1 | -1) => {
      const column = scope.current;
      if (column !== null) {
        moveRowFocus(null, delta, column);
      }
    },
    [scope],
  );

  // Stable apart from the index rows: the highlight resets only when the
  // rows on show change.
  const fixed = useMemo<readonly CommandMenuItemData[]>(() => {
    const pages = PAGE_KEYS.map((key) => ({
      value: `page:${key}`,
      label: PAGES[key].label,
      action: `Open ${PAGES[key].label}`,
      icon: ARTIFACT_ICONS[key],
      group: "Pages",
      onSelect: () => {
        openPage(key);
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
      "shortcut-sidebar": toggleSidebar,
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
        label: formatDay(day.date),
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
        label: formatDay(day.date),
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

  // A pick is held until the dialog has closed (`afterClose`).
  const items = useMemo(() => {
    const pages = fixed.filter((item) => item.group === "Pages");
    const rest = fixed.filter((item) => item.group !== "Pages");
    const rows =
      trimmed === ""
        ? [...pages, ...recentRows, ...rest]
        : [...pages, ...indexRows, ...rest];
    return rows.map((item): CommandMenuItemData => {
      const run = item.onSelect;
      return run === undefined
        ? item
        : {
            ...item,
            onSelect: () => {
              pick.current = run;
            },
          };
    });
  }, [fixed, indexRows, pick, recentRows, trimmed]);

  // The words for a query nothing matches, written into an always-mounted
  // polite region (FF's own empty row mounts with its text, which screen
  // readers may skip).
  const nothing =
    trimmed !== "" && !items.some((item) => menuFilter(item, query));
  const emptyWords = `No page, host, file, username or day matches "${trimmed}".`;

  return (
    <Dialog
      key={generation}
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
        }
        setOpen(next);
      }}
    >
      <DialogContent
        size="lg"
        showCloseButton={false}
        // FF's command-menu shell: opens centered at its cap and keeps that
        // top edge, so the field stays put while the rows filter down.
        position="top"
        className="top-[max(12dvh,calc(50dvh-220px))] flex max-h-[min(440px,76dvh)] flex-col overflow-hidden p-0"
        onCloseAutoFocus={afterClose}
      >
        <DialogTitle className="sr-only">Jump to</DialogTitle>
        <DialogDescription className="sr-only">
          Search pages, hosts, files, usernames and days of this Case.
        </DialogDescription>
        <CommandMenu
          items={items}
          query={query}
          onQueryChange={setQuery}
          filter={menuFilter}
          onSelect={() => {
            setQuery("");
            setOpen(false);
          }}
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
      </DialogContent>
    </Dialog>
  );
}
