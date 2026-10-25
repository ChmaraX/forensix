/**
 * One Sites host's evidence: every row core's `site-findings` puts on the
 * host (visits, downloads, cookies, saved logins, bookmarks, top sites,
 * favicons, cache entries - the same membership the host list counts),
 * grouped per kind, with the kind chips (in the URL) and the row sheet. A
 * URL-named row this host's read has not reached is looked up by its
 * reference on the host's own route.
 */
import { useMemo } from "react";

import { Panel } from "@/components/panel";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { ChevronLeftIcon } from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { SizeProvider, typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { RowLookupSource } from "../row-lookup.js";
import type { SiteArtifactKind, SiteFinding } from "../types.js";
import { useRowSelection, useViewFilter } from "../view-state.js";
import { EmptyRows } from "./data-table.js";
import { FaviconBitmapsContext } from "./favicons-fields.js";
import { SiteAvatar } from "./finding-fields.js";
import { ErrorRows, LoadingRows } from "./list-states.js";
import { CountChips, plural, type CountChip } from "./page-kit.js";
import { RowSheet, secretFieldsOf } from "./row-sheet.js";
import { useOwnBitmaps } from "./site-favicons.js";
import { SITE_KINDS } from "./site-kinds.js";
import { KindPanel, sheetTitle, type SiteRow } from "./sites-kind-tables.js";
import { useDrainedRead } from "./use-drained-read.js";

/** Pages of 100 rows the host's read follows (5,000 rows). */
export const SITE_PAGE_CAP = 50;

/** Stands in for the first kind panel while the host's rows load. */
export function DetailSkeleton() {
  return (
    <Panel className="overflow-clip">
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-3.5 w-24" />
      </div>
      <LoadingRows label="Loading the host's evidence" rows={4} />
    </Panel>
  );
}

const NO_ROWS: readonly SiteRow[] = [];

export function HostDetail({
  host,
  icon,
  wide,
  onBack,
}: {
  readonly host: string;
  /** The host's recovered favicon (`data:` URI), when the Case has one. */
  readonly icon: string | undefined;
  /** From `md` up: the detail sticks beside the host list. */
  readonly wide: boolean;
  /** Back to the host list (below `md`, where the two are one screen at a
   *  time). */
  readonly onBack: () => void;
}) {
  const parameters = useMemo(
    () =>
      [
        ["host", host],
        ["limit", "100"],
      ] as const,
    [host],
  );
  const read = useDrainedRead<SiteFinding>(
    "site-findings",
    parameters,
    SITE_PAGE_CAP,
  );
  const rows = read.rows ?? NO_ROWS;
  // The kind chip is in the URL (`filter`), so refresh and Back keep it.
  const [kindPick, setKindFilter] = useViewFilter();
  // A URL-named row past the host's read is looked up on its route: the
  // host's own rows of the row's profile and Commit State.
  const lookup = useMemo<RowLookupSource>(
    () => ({
      route: "site-findings",
      parameters: [["host", host]],
    }),
    [host],
  );
  const sheet = useRowSelection(rows, lookup);

  const grouped = useMemo(() => {
    const groups = new Map<SiteArtifactKind, SiteRow[]>();
    for (const row of rows) {
      const group = groups.get(row.artifactKind) ?? [];
      group.push(row);
      groups.set(row.artifactKind, group);
    }
    return groups;
  }, [rows]);
  // Each favicon row's own stored bitmap (as on the Favicons page).
  const bitmaps = useOwnBitmaps(grouped.get("favicons") ?? NO_ROWS);

  const presentKinds = SITE_KINDS.filter(
    (meta) => (grouped.get(meta.kind) ?? []).length > 0,
  );
  // A kind from the URL counts only when this host has rows of it.
  const kindFilter =
    presentKinds.find((meta) => meta.kind === kindPick)?.kind ?? null;
  // Every page has settled (or failed): the kinds, chips and panels land
  // together instead of shifting as each page arrives.
  const ready = !read.draining;
  const incomplete = read.error === null && ready && !read.complete;
  // The chips and header count saved rows, like each kind panel's count
  // and the host list's card; recovered rows stay in their own lists.
  const savedIn = (list: readonly SiteRow[]) =>
    list.filter((row) => row.commitState === "committed").length;
  const saved = savedIn(rows);
  const recovered = rows.length - saved;
  const detailCounts = [
    `${plural(saved, "saved row", "saved rows")} in ${plural(presentKinds.length, "kind", "kinds")}`,
    ...(recovered > 0
      ? [plural(recovered, "recovered row", "recovered rows")]
      : []),
  ].join(" · ");

  return (
    // The host's region holds all of its evidence, named by the host.
    <section
      aria-labelledby="sites-host-title"
      className={cn(
        "flex min-w-0 flex-col gap-5",
        // From `md` up the detail sticks under the topbar beside the host
        // list and scrolls on its own, so the evidence of a host picked
        // far down the list starts in view. Keyed by host, so a new host
        // starts at its top.
        wide &&
          "scroll-fade sticky top-16 -mx-1 max-h-[calc(100dvh-5rem)] overflow-y-auto px-1 pb-1",
      )}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <SizeProvider size="compact">
          <Button
            variant="ghost"
            leadingIcon={ChevronLeftIcon}
            onClick={onBack}
            className="self-start md:hidden"
          >
            All hosts
          </Button>
        </SizeProvider>
        <div className="flex min-w-0 items-center gap-4 px-1">
          <SiteAvatar host={host} size="lg" src={icon} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2
              id="sites-host-title"
              className={cn(
                typeClass("title"),
                "min-w-0 truncate text-foreground",
              )}
              style={{ fontVariationSettings: fontWeights.semibold }}
              title={host}
            >
              {host}
            </h2>
            {/* What the host holds, once every page is in: saved rows
                across its kinds, recovered named beside, never summed. */}
            {ready && rows.length > 0 ? (
              <p
                className={cn(
                  typeClass("caption"),
                  "text-muted-foreground tabular-nums",
                )}
              >
                {detailCounts}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {read.error === null ? null : (
        <Panel>
          <ErrorRows
            title="This host's evidence could not be loaded."
            message={read.error}
            onRetry={read.retry}
          />
        </Panel>
      )}

      {read.error !== null && rows.length === 0 ? null : ready &&
        rows.length === 0 ? (
        <Panel>
          <EmptyRows message="No recorded rows for this host." />
        </Panel>
      ) : (
        <div className="reveal-swap">
          <DetailSkeleton />
          {ready && rows.length > 0 ? (
            <FaviconBitmapsContext.Provider value={bitmaps}>
              <div className="flex flex-col gap-5">
                {incomplete ? (
                  <Banner status="info" contrast="high" size="compact">
                    <BannerTitle>
                      Not every row of this host is listed
                    </BannerTitle>
                    <BannerDescription>
                      {`Sites reads the first ${(SITE_PAGE_CAP * 100).toLocaleString("en-US")} rows of a host; the artifact pages list the rest.`}
                    </BannerDescription>
                  </Banner>
                ) : null}
                {presentKinds.length > 1 ? (
                  <SizeProvider size="compact">
                    <CountChips
                      label="Evidence kind"
                      total={saved}
                      chips={presentKinds.map(
                        (meta): CountChip => ({
                          key: meta.kind,
                          label: meta.label,
                          count: savedIn(grouped.get(meta.kind) ?? []),
                        }),
                      )}
                      active={kindFilter}
                      partial={incomplete}
                      onChange={(key) => {
                        setKindFilter(
                          presentKinds.find((meta) => meta.kind === key)
                            ?.kind ?? null,
                        );
                      }}
                    />
                  </SizeProvider>
                ) : null}
                <div
                  key={kindFilter ?? "all"}
                  className="reveal-items flex flex-col gap-5"
                >
                  {presentKinds
                    .filter(
                      (meta) => kindFilter === null || kindFilter === meta.kind,
                    )
                    .map((meta) => (
                      <KindPanel
                        key={meta.kind}
                        meta={meta}
                        rows={grouped.get(meta.kind) ?? []}
                        onSelect={sheet.select}
                      />
                    ))}
                </div>
              </div>
            </FaviconBitmapsContext.Provider>
          ) : null}
        </div>
      )}

      {sheet.selected === null ? null : (
        <RowSheet
          selected={sheet.selected}
          title={sheetTitle(sheet.selected.row)}
          redactedFields={secretFieldsOf(sheet.selected.row)}
          onClose={sheet.close}
        />
      )}
    </section>
  );
}
