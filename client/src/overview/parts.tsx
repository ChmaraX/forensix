/**
 * The Overview's building blocks, composed from Fluid Functionalism parts and
 * the shared page kit: `MetricBand` for the figure strip, `SectionPanel` /
 * `ChartSection` for every framed section (see overview.tsx), FF `Button`
 * jump links, `ShareBar` for the Most visited sites bars, one
 * `useFluidHover` highlight per link list, and `EmptyRows` for empty
 * lists. Every row that leads somewhere is a real `<a href="#/…">` (a new
 * tab works, Back returns here) and a `data-row-nav` stop for J / K.
 */
import { useRef, type ReactNode } from "react";

import { EmptyRows } from "@/components/data-table";
import { toRow } from "@/components/downloads-model";
import { DownloadSize, DownloadState } from "@/components/downloads-table";
import { EvidenceDot } from "@/components/evidence";
import { FieldCell } from "@/components/finding-fields";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import {
  MetricBand,
  MetricBandItem,
  TooltipFigure,
} from "@/components/metric-band";
import { plural, ShareBar, TimeText, TypeLabel } from "@/components/page-kit";
import { Panel } from "@/components/panel";
import { Term } from "@/components/term";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import {
  ARTIFACT_ICONS,
  DownloadedFileIcon,
  EmptyIcon,
  ExternalLinkIcon,
  UserIcon,
  type ArtifactIconKey,
} from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import type { EvidenceKey } from "@/artifacts";
import { COMMIT_META } from "@/terms";
import type { FieldState, Finding } from "@/types";

import type { RecoveredCount, TopSite } from "./data";

// ---------------------------------------------------------------------------
// Jump link
// ---------------------------------------------------------------------------

/**
 * A panel's jump link (the `aside` of a SectionPanel, the `action` of a
 * ChartSection): an FF ghost button, a real link to the page the panel
 * summarizes, carrying the Case's date range. The panel itself stays a
 * plain reading surface (values can be selected, chart tooltips hovered)
 * rather than one big click target.
 */
export function JumpLink({
  label,
  href,
  description,
  className,
}: {
  readonly label: string;
  readonly href: string;
  readonly className?: string;
  /** The accessible name when the visible label alone is not enough
   *  ("Open 12 Mar 2024 in Timeline"). @default "Open {label}" */
  readonly description?: string;
}) {
  return (
    <Button
      asChild
      variant="ghost"
      size="compact"
      trailingIcon={ExternalLinkIcon}
      className={cn("-my-1 -mr-2 shrink-0", className)}
    >
      <a href={href} aria-label={description ?? `Open ${label}`}>
        {label}
      </a>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Masthead
// ---------------------------------------------------------------------------

/**
 * The Case masthead: whose browser this is, in the display role, with the
 * date range on the right. It sits on the page substrate like every other
 * page header — no saturated slab — so the first framed surface the examiner
 * meets is the figure band and then the evidence.
 */
export function Masthead({
  subjectName,
  meta,
  coverage,
  picker,
}: {
  readonly subjectName: string | null;
  readonly meta: string;
  /** The shell's whole-Case coverage indicator, before the picker. */
  readonly coverage?: ReactNode;
  readonly picker: ReactNode;
}) {
  const size = useSize();
  return (
    <header
      aria-label="Case masthead"
      className="flex flex-col gap-4 pt-2 md:flex-row md:items-start md:justify-between md:gap-8"
    >
      <div className="flex min-w-0 items-center gap-4">
        <span
          aria-hidden="true"
          className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-hover text-muted-foreground"
        >
          <UserIcon size={size.icon} strokeWidth={1.5} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1
            className={cn(
              typeClass("display"),
              "truncate",
              subjectName === null
                ? "text-muted-foreground"
                : "text-foreground",
            )}
            style={{ fontVariationSettings: fontWeights.bold }}
          >
            {subjectName ?? "Subject not recorded"}
          </h1>
          {meta.length > 0 ? (
            <p
              className={cn(
                typeClass("body"),
                "text-muted-foreground sm:truncate",
              )}
            >
              {meta}
            </p>
          ) : null}
        </div>
      </div>
      {/* Below `md` the pair sits under the subject, flush left: the
          ghost indicator's own padding is pulled back so its words align
          with the name above, and both fit one phone line. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-2 md:gap-2 md:pt-1">
        {coverage === undefined || coverage === null ? null : (
          <span className="flex max-md:-ml-3">{coverage}</span>
        )}
        {picker}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Figure band
// ---------------------------------------------------------------------------

/** A count printed as recorded. Figures never count up or tween: every
 *  in-between number would be a figure the evidence does not contain. */
function CountValue({ count }: { readonly count: number }) {
  return <>{count.toLocaleString("en-US")}</>;
}

export interface CaseFigure {
  readonly key: string;
  readonly label: ReactNode;
  /** A number is printed as recorded; a string is printed as is. */
  readonly value: number | string;
  /** False when the value is a word for "nothing of that shape" (e.g. "No
   *  dated activity"), so it reads as a muted state, not a recorded figure. */
  readonly recorded: boolean;
  /** A sub-line only when it is itself data (a date range) — never a
   *  caption explaining the figure. */
  readonly detail?: string;
  /** Data behind the value, on hover and focus (the profile names). */
  readonly valueTooltip?: string;
}

/**
 * The Case figures: one `MetricBand` of recorded readings, label and value.
 * Each is a plain reading of a number the page already computed — never a
 * Candidate, never a new query.
 */
export function CaseFigures({
  items,
}: {
  readonly items: readonly CaseFigure[];
}) {
  return (
    <section aria-label="Case figures">
      <MetricBand className="grid-cols-2 lg:grid-cols-4">
        {items.map((item) => {
          // A word for "nothing of that shape" reads at body size inside
          // the figure's line box: muted, not dressed as a figure, and the
          // strip keeps its height.
          const value =
            typeof item.value === "number" ? (
              <CountValue count={item.value} />
            ) : item.recorded ? (
              item.value
            ) : (
              <span
                className={typeClass("body")}
                style={{ fontVariationSettings: fontWeights.normal }}
              >
                {item.value}
              </span>
            );
          return (
            <MetricBandItem
              key={item.key}
              label={item.label}
              value={
                item.valueTooltip === undefined ? (
                  value
                ) : (
                  <TooltipFigure value={value} detail={item.valueTooltip} />
                )
              }
              valueClassName={
                item.recorded ? undefined : "text-muted-foreground"
              }
              detail={item.detail}
            />
          );
        })}
      </MetricBand>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

/**
 * The subject readout: plain-language labels against the Metadata values,
 * each rendered through the shared `FieldCell`, so (empty), `absent` and
 * `unavailable` read exactly as they do on every list page — never a blank,
 * never silently skipped.
 */
export function SubjectList({
  fields,
}: {
  readonly fields: readonly {
    readonly label: string;
    readonly field: FieldState | undefined;
  }[];
}) {
  return (
    <dl className="flex flex-col px-4 pb-3">
      {fields.map(({ label, field }) => (
        <div
          key={label}
          className="grid min-h-9 grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-center gap-3 border-t border-border py-2 first:border-t-0"
        >
          <dt
            className={cn(typeClass("body"), "truncate text-muted-foreground")}
          >
            {label}
          </dt>
          <dd className="min-w-0">
            {field?.state === "unavailable" ? (
              // The narrow value column keeps the word and its dot; the
              // reason is the word's tooltip (a focusable Term), read whole
              // instead of cut mid-sentence.
              <span
                className={cn(
                  typeClass("body"),
                  "inline-flex items-center gap-1.5 whitespace-nowrap text-foreground",
                )}
              >
                <EvidenceDot state="unavailable" />
                <Term label="unavailable">{field.reason}</Term>
              </span>
            ) : (
              <FieldCell field={field} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Link lists
// ---------------------------------------------------------------------------

/** One fluid hover highlight gliding between a list's link rows (FF's
 *  custom hover list); `null` while the list has no rows. */
function useLinkList() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(containerRef, { axis: "y" });
  return { containerRef, hover };
}

type HoverRegister = (index: number, element: HTMLElement | null) => void;

/** A link row's focus ring: keyboard only, inset so the panel clips none. */
const LINK_ROW_CLASS =
  "relative w-full cursor-pointer rounded-lg px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset";

/** One row of a link list: a real link, registered with the list's hover
 *  highlight, and a J / K stop. */
function LinkRow({
  href,
  index,
  registerItem,
  label,
  title,
  className,
  children,
}: {
  readonly href: string;
  readonly index: number;
  readonly registerItem: HoverRegister;
  /** The accessible name: the row's words, then where it leads. */
  readonly label: string;
  readonly title?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  return (
    <a
      ref={ref}
      href={href}
      data-row-nav=""
      aria-label={label}
      title={title}
      className={cn(LINK_ROW_CLASS, className)}
    >
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Most visited sites
// ---------------------------------------------------------------------------

/**
 * A site's identity mark: the favicon recovered from the Case's own
 * `Favicons` database, as the inline `data:` URI the server resolved — never
 * a live-fetched icon, the dashboard's CSP forbids that. `null` means no
 * recovered favicon for this host, so a neutral letter tile stands in.
 */
function SiteMark({
  domain,
  favicon,
}: {
  readonly domain: string;
  readonly favicon: string | null | undefined;
}) {
  if (favicon !== null && favicon !== undefined) {
    return (
      <span className="inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-hover">
        <img
          src={favicon}
          alt=""
          aria-hidden="true"
          className="size-3.5 object-contain"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        typeClass("micro"),
        "inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-hover text-muted-foreground",
      )}
      style={{ fontVariationSettings: fontWeights.semibold }}
    >
      {domain.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * The Most visited sites list: hosts ranked by saved visit rows, the count
 * Sites prints beside the same host ("4 visits"). Each row opens that host
 * on Sites; one fluid hover highlight glides between them.
 */
export function TopSitesList({
  sites,
  favicons,
  hrefOf,
  emptyMessage = "No saved page visits are recorded in this Case.",
}: {
  readonly emptyMessage?: string;
  readonly sites: readonly TopSite[];
  readonly favicons: ReadonlyMap<string, string | null>;
  /** The link for a host (Sites, focused on it). */
  readonly hrefOf: (host: string) => string;
}) {
  const { containerRef, hover } = useLinkList();
  const peak = Math.max(...sites.map((site) => site.count), 0);
  if (sites.length === 0) {
    return (
      <EmptyRows
        icon={ARTIFACT_ICONS.sites}
        message={emptyMessage}
        className="flex-1 justify-center py-8"
      />
    );
  }
  return (
    <div
      ref={containerRef}
      className="relative flex flex-col px-1 pb-2"
      {...hover.handlers}
    >
      <FluidHoverHighlight hover={hover} className="rounded-lg" />
      {sites.map((site, index) => {
        return (
          <LinkRow
            key={site.host}
            href={hrefOf(site.host)}
            index={index}
            registerItem={hover.registerItem}
            label={`${site.host}, ${plural(site.count, "saved visit", "saved visits")} - open in Sites`}
            // On a phone the share bar steps aside so the host reads whole
            // (the count beside it still orders the list).
            className="grid h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <SiteMark domain={site.host} favicon={favicons.get(site.host)} />
              <span
                className={cn(typeClass("body"), "truncate text-foreground")}
                title={site.host}
              >
                {site.host}
              </span>
            </span>
            {/* The bar keeps a reading length on the wide column. */}
            <span className="block w-full max-w-sm max-sm:hidden">
              <ShareBar
                fraction={peak === 0 ? 0 : site.count / peak}
                peak={peak > 0 && site.count === peak}
              />
            </span>
            {/* "4 visits", worded as Sites words it: the count is a number
                of saved visit rows, nothing else. */}
            <span
              className={cn(
                typeClass("body"),
                "min-w-[4.5rem] text-right whitespace-nowrap tabular-nums",
              )}
            >
              <span className="text-foreground">
                {site.count.toLocaleString("en-US")}
              </span>
              <span className="text-muted-foreground">
                {site.count === 1 ? " visit" : " visits"}
              </span>
            </span>
          </LinkRow>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent downloads
// ---------------------------------------------------------------------------

/**
 * The Recent downloads list: one row per saved download - the file (full
 * recorded path on hover) over its source host, then its outcome in words,
 * the size it actually reached and when it started. Each row opens that
 * download's own row on the Downloads page. Below `md` the row stacks:
 * file, host, then outcome · size · time on one line. Size and source are
 * read as the Downloads page reads them (`toRow`, `DownloadSize`): bytes
 * received, the expected size beside them only while they fall short.
 */
export function DownloadsList({
  downloads,
  hrefOf,
  emptyMessage = "No saved downloads are recorded in this Case.",
}: {
  readonly downloads: readonly Finding[];
  /** The link for a download (its row on the Downloads page). */
  readonly hrefOf: (download: Finding) => string;
  readonly emptyMessage?: string;
}) {
  const { containerRef, hover } = useLinkList();
  if (downloads.length === 0) {
    return (
      <EmptyRows
        icon={DownloadedFileIcon}
        message={emptyMessage}
        className="flex-1 justify-center py-8"
      />
    );
  }
  return (
    <div
      ref={containerRef}
      className="relative flex flex-col px-1 pb-2"
      {...hover.handlers}
    >
      <FluidHoverHighlight hover={hover} className="rounded-lg" />
      {downloads.map((download, index) => {
        // The Downloads page's own reading of the row: file name, source
        // host and the received / expected sizes, so both pages agree.
        const row = toRow(download);
        const { name, host, state } = row;
        return (
          <LinkRow
            key={download.provenance.rowId ?? String(index)}
            href={hrefOf(download)}
            index={index}
            registerItem={hover.registerItem}
            label={[
              name ?? "Download",
              state,
              host === null ? null : `from ${host}`,
              "open in Downloads",
            ]
              .filter((part) => part !== null)
              .join(", ")}
            title={row.path ?? undefined}
            className="flex flex-col gap-1 py-2.5 md:grid md:min-h-14 md:grid-cols-[minmax(0,1fr)_7rem_9.5rem_11rem] md:items-center md:gap-4 md:py-2"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              {name === null ? (
                <FieldCell field={download.fields.targetPath} />
              ) : (
                <span
                  className={cn(typeClass("body"), "truncate text-foreground")}
                  style={{ fontVariationSettings: fontWeights.semibold }}
                >
                  {name}
                </span>
              )}
              <span
                className={cn(
                  typeClass("caption"),
                  "truncate text-muted-foreground",
                )}
              >
                {host ?? "Source not recorded"}
              </span>
            </span>
            <span
              className={cn(
                typeClass("body"),
                // Below md, one fixed shape for every card: outcome and
                // size on the first line (size at the right), the time on
                // its own line - never a wrap that depends on the lengths.
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 md:contents",
              )}
            >
              <span className="min-w-0">
                <DownloadState field={download.fields.state} />
              </span>
              <span className="min-w-0 text-right">
                <DownloadSize row={row} />
              </span>
              <TimeText
                field={download.fields.startTime}
                className="max-md:col-span-2 md:text-right"
              />
            </span>
          </LinkRow>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recovered
// ---------------------------------------------------------------------------

/** "1,000+" when the read stopped at its cap. */
function countText(count: number, more: boolean): string {
  return `${count.toLocaleString("en-US")}${more ? "+" : ""}`;
}

/** "Bookmarks", "Bookmarks or Browser profile", "A, B or C". */
function orList(words: readonly string[]): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1] ?? ""}`;
}

/** One recovered part: the state's dot, the count and its word. */
function RecoveredPart({
  state,
  count,
  more,
}: {
  readonly state: "wal_resident" | "journal_resident";
  readonly count: number;
  readonly more: boolean;
}) {
  // "recovered - unsaved" → "unsaved": the panel's title already says
  // recovered; the dot repeats the word's hue, never stands in for it.
  const meta = COMMIT_META[state];
  const word = meta.label.replace(/^recovered - /, "");
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <EvidenceDot state={meta.badge} />
      <span className="text-foreground tabular-nums">
        {countText(count, more)}
      </span>
      <span className="text-muted-foreground">{word}</span>
    </span>
  );
}

/** How much of one artifact's evidence was read, from the Completeness
 *  Statement: `null` when every database was. */
export interface ArtifactCoverage {
  readonly produced: number;
  readonly attempted: number;
}

/**
 * The Recovered panel's list: one row per evidence page holding recovered
 * rows, in the sidebar's order, its write-ahead-log rows (unsaved) and
 * rollback-journal rows (overwritten) counted apart, each row opening that
 * page's Recovered tab. Pages with nothing recovered are named once,
 * below. Counts are never summed into a figure.
 */
export function RecoveredList({
  counts,
  coverageOf,
  hrefOf,
}: {
  readonly counts: readonly RecoveredCount[];
  readonly coverageOf: (artifact: string) => ArtifactCoverage | null;
  /** The link to a page's Recovered tab. */
  readonly hrefOf: (page: EvidenceKey) => string;
}) {
  const { containerRef, hover } = useLinkList();
  // A page counts as "nothing recovered" only when its databases were read:
  // a page whose evidence was not read keeps its row and says so.
  const listed = counts.filter(
    (count) =>
      count.wal + count.journal > 0 || coverageOf(count.artifact) !== null,
  );
  const none = counts
    .filter((count) => !listed.includes(count))
    .map((count) => count.label);
  if (listed.length === 0) {
    return (
      <EmptyRows
        icon={EmptyIcon}
        message="Nothing recovered: no row was found only in Chrome's write-ahead logs or rollback journals."
        className="flex-1 justify-center py-8"
      />
    );
  }
  return (
    <div className="flex flex-1 flex-col">
      <div
        ref={containerRef}
        className="relative flex flex-col px-1"
        {...hover.handlers}
      >
        <FluidHoverHighlight hover={hover} className="rounded-lg" />
        {listed.map((count, index) => {
          const coverage = coverageOf(count.artifact);
          const parts = [
            count.wal > 0
              ? `${countText(count.wal, count.more)} unsaved`
              : null,
            count.journal > 0
              ? `${countText(count.journal, count.more)} overwritten`
              : null,
          ].filter((part) => part !== null);
          // Nothing read: nothing could be recovered either, so the row
          // says "not read" in place of counts. Partly read: the counts,
          // with how much they come from under the page's name.
          const unread = coverage !== null && coverage.produced === 0;
          const read =
            coverage === null || unread
              ? null
              : `${String(coverage.produced)}/${String(coverage.attempted)} read`;
          return (
            <LinkRow
              key={count.page}
              href={hrefOf(count.page)}
              title={
                coverage === null || unread
                  ? undefined
                  : `${String(coverage.produced)} of ${plural(coverage.attempted, "database", "databases")} read`
              }
              index={index}
              registerItem={hover.registerItem}
              label={`${count.label}: ${
                unread
                  ? "not read"
                  : parts.length === 0
                    ? "nothing recovered"
                    : parts.join(", ")
              }${
                coverage === null || unread
                  ? ""
                  : ` (${String(coverage.produced)} of ${plural(coverage.attempted, "database", "databases")} read)`
              } - open its Recovered tab`}
              className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-1.5"
            >
              <span className="flex min-w-0 flex-col">
                <span className={cn(typeClass("body"), "text-foreground")}>
                  <TypeLabel
                    icon={ARTIFACT_ICONS[count.page as ArtifactIconKey]}
                    label={count.label}
                  />
                </span>
                {read === null ? null : (
                  // Words only: an amber dot here would read as "unsaved".
                  <span
                    className={cn(
                      typeClass("caption"),
                      "pl-6 text-muted-foreground",
                    )}
                  >
                    {read}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  typeClass("body"),
                  "flex flex-wrap items-center justify-end gap-x-3",
                )}
              >
                {count.wal > 0 ? (
                  <RecoveredPart
                    state="wal_resident"
                    count={count.wal}
                    more={count.more}
                  />
                ) : null}
                {count.journal > 0 ? (
                  <RecoveredPart
                    state="journal_resident"
                    count={count.journal}
                    more={count.more}
                  />
                ) : null}
                {parts.length === 0 ? (
                  <span className="text-muted-foreground">
                    {unread ? "not read" : "none"}
                  </span>
                ) : null}
              </span>
            </LinkRow>
          );
        })}
      </div>
      {none.length === 0 ? null : (
        <p
          className={cn(
            typeClass("caption"),
            "mt-auto px-4 pt-2 pb-3 text-muted-foreground",
          )}
        >
          Nothing recovered from {orList(none)}.
        </p>
      )}
    </div>
  );
}

/** The panel title's explanation of "Recovered" (the words every
 *  Recovered tab carries). */
export function RecoveredTitle() {
  return (
    <Term
      label="Recovered"
      technical="Commit State: wal_resident (WAL) or journal_resident (rollback journal)"
    >
      Rows found only in Chrome&apos;s temporary database files (write-ahead log
      or rollback journal). They can include entries that were deleted or
      overwritten in the saved database.
    </Term>
  );
}

/** The Recovered panel's skeleton, the size of its rows. */
export function LoadingRecovered() {
  return (
    <div
      role="status"
      className="reveal-items flex flex-col gap-0 px-4 pt-1 pb-3"
    >
      <span className="sr-only">Counting recovered rows</span>
      {[0, 1, 2, 3, 4, 5].map((key) => (
        <div key={key} className="flex h-9 items-center justify-between">
          <Skeleton className="h-3.5 w-24 rounded-md" />
          <Skeleton className="h-3.5 w-28 rounded-md" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function SkeletonPanel({
  className,
  bodyClassName,
}: {
  readonly className?: string;
  readonly bodyClassName?: string;
}) {
  return (
    <Panel className={className}>
      <div className="px-4 pt-4 pb-2">
        <Skeleton className="h-4 w-28 rounded-md" />
      </div>
      <div className={cn("px-4 pt-2 pb-4", bodyClassName)}>
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    </Panel>
  );
}

/**
 * The page's skeleton, laid out on the real page's grid at (no more than)
 * its blocks' sizes — masthead, the four-figure band, the first panel row —
 * so the `reveal-swap` hand-over never shifts layout. A live status region,
 * so the load is announced rather than silent.
 */
export function LoadingOverview({
  className,
}: {
  readonly className?: string;
}) {
  return (
    <div role="status" className={cn("flex flex-col gap-5", className)}>
      <span className="sr-only">Loading overview</span>
      <div className="flex items-center gap-4 pt-2">
        <Skeleton className="size-12 rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56 rounded-md" />
          <Skeleton className="h-4 w-72 max-w-[60vw] rounded-md" />
        </div>
      </div>
      <Panel className="overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <div
              key={key}
              className="flex flex-col gap-2 px-4 py-3 shadow-[-1px_0_0_0_var(--border),0_-1px_0_0_var(--border)] sm:px-5 sm:py-3.5"
            >
              <Skeleton className="h-3 w-20 rounded-md" />
              <Skeleton className="h-5 w-24 rounded-md" />
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid grid-cols-12 gap-4">
        <SkeletonPanel
          className="col-span-12 lg:col-span-8"
          bodyClassName="h-[240px]"
        />
        <SkeletonPanel
          className="col-span-12 lg:col-span-4"
          bodyClassName="h-[240px]"
        />
      </div>
    </div>
  );
}
