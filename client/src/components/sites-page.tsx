/**
 * The Sites page.
 *
 * A host-centric read of the evidence, as a master–detail pair: every
 * observed host on the left (`HostList`), ordered by how much saved
 * evidence it carries; on the right the selected host's records, grouped
 * per evidence kind (`HostDetail`). Which rows are on a host is core's
 * (`site-hosts` / `site-findings`, keyed by `siteHostKey` over
 * `SITE_HOST_FIELDS`): visits, downloads, cookies, saved logins,
 * bookmarks, top sites, favicons and cache entries, so the list's counts
 * and the host's rows always agree.
 *
 * From `md` up both panes stick under the topbar and scroll on their own,
 * so a host picked far down the list shows its evidence in view; with no
 * host in the URL the most-evidenced host is on show (the list's first).
 * Below `md` the two are one screen at a time: the host list, then the host
 * with a way back.
 *
 * Presentation rules kept: hosts and counts are grouped records, never
 * inference; states are worded, never colour alone; a field without its own
 * recorded value shows its own word; within each kind, rows recovered from
 * the WAL / rollback journal are a separate list from saved rows.
 */
import { useCallback, useMemo, useRef } from "react";

import type { SiteHost } from "../types.js";
import { useViewHost, useViewSearch } from "../view-state.js";
import { rowsTotalOf, savedTotalOf } from "./site-kinds.js";
import { HostList, hostCardLabel } from "./sites-host-list.js";
import {
  DetailSkeleton,
  HostDetail,
  SITE_PAGE_CAP,
} from "./sites-host-detail.js";
import { useHostFavicons } from "./sites-hosts.js";
import { useDrainedRead } from "./use-drained-read.js";
import { useMediaQuery } from "./use-media-query.js";

/** Tailwind's `md` breakpoint (48rem): the two panes side by side. */
const MD_UP = "(min-width: 48rem)";

const HOST_PARAMETERS = [["limit", "100"]] as const;
const NO_HOSTS: readonly SiteHost[] = [];

export function SitesPage() {
  // The host search lives in the URL (`q`): Back and a refresh keep it.
  const [search, setSearch] = useViewSearch();
  // The host on show lives in the URL (`host`): an Overview or Related link
  // opens Sites on it, and Back returns to the previous host.
  const [host, setHost] = useViewHost();
  const wide = useMediaQuery(MD_UP);
  const detailRef = useRef<HTMLDivElement>(null);
  const hostRead = useDrainedRead<SiteHost>(
    "site-hosts",
    useMemo(
      () =>
        search.length === 0
          ? HOST_PARAMETERS
          : [...HOST_PARAMETERS, ["search", search] as const],
      [search],
    ),
    SITE_PAGE_CAP,
  );
  const hostRows = hostRead.rows ?? NO_HOSTS;
  // Loading until every page is in (or the cap or a failure stops it).
  const hostsLoading = hostRead.draining;
  // Most saved evidence first (then every row, then the name): the route
  // pages hosts by name, so the order is set once every page is in.
  const sortedHosts = useMemo(
    () =>
      [...hostRows].sort(
        (left, right) =>
          savedTotalOf(right) - savedTotalOf(left) ||
          rowsTotalOf(right) - rowsTotalOf(left) ||
          (left.host < right.host ? -1 : left.host > right.host ? 1 : 0),
      ),
    [hostRows],
  );
  const shownHosts = useMemo(
    () => (hostsLoading ? [] : sortedHosts),
    [hostsLoading, sortedHosts],
  );
  const icons = useHostFavicons(
    useMemo(() => shownHosts.map((entry) => entry.host), [shownHosts]),
  );

  // With no host in the URL, from `md` up the most-evidenced host is on
  // show (the list's first) rather than an empty pane; below `md` the list
  // is the screen. The URL stays without a host, so Back still means
  // "before Sites".
  const onShow = host ?? (wide ? (shownHosts[0]?.host ?? null) : null);

  // Below `md` the list and the detail are one screen at a time: picking a
  // host swaps the list for its evidence, from the top. Where the list was
  // when a host was picked: "All hosts" puts the list back at that scroll
  // position with focus on that host's card.
  const listScroll = useRef(0);
  const pickHost = useCallback(
    (next: string) => {
      setHost(next);
      if (!wide) {
        listScroll.current = window.scrollY;
        requestAnimationFrame(() => {
          detailRef.current?.scrollIntoView({ block: "start" });
        });
      }
    },
    [setHost, wide],
  );
  const backToHosts = useCallback(() => {
    const previous = sortedHosts.find((entry) => entry.host === host);
    setHost(null);
    requestAnimationFrame(() => {
      window.scrollTo({ top: listScroll.current });
      if (previous !== undefined) {
        document
          .querySelector<HTMLElement>(
            `[aria-label="${CSS.escape(hostCardLabel(previous))}"]`,
          )
          ?.focus({ preventScroll: true });
      }
    });
  }, [host, setHost, sortedHosts]);

  return (
    <div className="grid items-start gap-5 md:grid-cols-[minmax(240px,0.36fr)_minmax(0,1fr)]">
      <HostList
        hosts={shownHosts}
        complete={hostRead.complete}
        loading={hostsLoading}
        error={hostRead.error}
        onRetry={hostRead.retry}
        search={search}
        onSearch={setSearch}
        selected={onShow}
        onSelect={pickHost}
        icons={icons}
        className={host === null ? undefined : "max-md:hidden"}
      />
      <div ref={detailRef} className="min-w-0 scroll-mt-16">
        {onShow === null ? (
          wide ? (
            // The list is loading (or empty): the pane holds its place.
            hostsLoading ? (
              <DetailSkeleton />
            ) : null
          ) : null
        ) : (
          <HostDetail
            key={onShow}
            host={onShow}
            icon={icons.get(onShow)}
            wide={wide}
            onBack={backToHosts}
          />
        )}
      </div>
    </div>
  );
}
