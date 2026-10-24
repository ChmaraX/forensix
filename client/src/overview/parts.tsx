/**
 * The Overview's building blocks, composed from Fluid Functionalism parts and
 * the shared page kit: `MetricBand` for the figure strip, `SectionPanel` /
 * `ChartSection` for every framed section (see overview.tsx), FF `Button`
 * jump links, `ShareBar` for the Top sites bars, one `useFluidHover`
 * highlight for the Top sites list, `EmptyRows` for empty lists, and springs
 * for the little motion there is (figure counts).
 */
import { ArrowUpRight, FileDown, Globe, UserRound } from "lucide-react";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { EmptyRows } from "@/components/data-table";
import { FieldCell } from "@/components/finding-fields";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { MetricBand, MetricBandItem } from "@/components/metric-band";
import { IconTile, ShareBar, TimeText } from "@/components/page-kit";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { fontWeights } from "@/lib/font-weight";
import { typeClass, useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import type { FieldState, Finding } from "@/types";

import { domainOf, downloadFileName, type TopSite } from "./data";

/** The enter half of a spring token, for `animate()` (which takes no exit). */
const MODERATE = {
  type: spring.moderate.type,
  duration: spring.moderate.duration,
  bounce: spring.moderate.bounce,
};

// ---------------------------------------------------------------------------
// Jump link
// ---------------------------------------------------------------------------

/**
 * A panel's jump link (the `aside` of a SectionPanel, the `action` of a
 * ChartSection): an FF ghost button that opens the section the panel
 * summarizes. The panel itself stays a plain reading surface (values can be
 * selected, chart tooltips hovered) rather than one big click target.
 */
export function JumpLink({
  label,
  onOpen,
}: {
  readonly label: string;
  readonly onOpen?: () => void;
}) {
  if (onOpen === undefined) {
    return null;
  }
  return (
    <Button
      variant="ghost"
      size="compact"
      trailingIcon={ArrowUpRight}
      onClick={onOpen}
      aria-label={`Open ${label}`}
      className="-my-1 -mr-2 shrink-0"
    >
      {label}
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
  rangeNote,
  picker,
}: {
  readonly subjectName: string | null;
  readonly meta: string;
  readonly rangeNote: string | null;
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
          <UserRound size={size.icon} strokeWidth={1.5} />
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
                "truncate text-muted-foreground",
              )}
            >
              {meta}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-1.5 md:items-end">
        {picker}
        {rangeNote === null ? null : (
          <p
            className={cn(
              typeClass("caption"),
              "max-w-[44ch] text-muted-foreground md:text-right",
            )}
          >
            {rangeNote}
          </p>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Figure band
// ---------------------------------------------------------------------------

/**
 * Eases a figure to its true value on mount and whenever the value changes
 * (a range edit re-runs it, so the band visibly re-counts). It rides
 * `spring.moderate` — critically damped, so a count never overshoots past the
 * recorded number — and under reduced motion the true value renders at once.
 */
function useCountUp(target: number): number {
  const reduced = useReducedMotion() ?? false;
  const [value, setValue] = useState(reduced ? target : 0);
  const current = useRef(value);
  useEffect(() => {
    if (reduced) {
      current.current = target;
      setValue(target);
      return;
    }
    const controls = animate(current.current, target, {
      ...MODERATE,
      onUpdate: (latest) => {
        current.current = latest;
        setValue(Math.round(latest));
      },
    });
    return () => {
      controls.stop();
    };
  }, [target, reduced]);
  return value;
}

function CountValue({ count }: { readonly count: number }) {
  const shown = useCountUp(count);
  return <>{shown.toLocaleString("en-US")}</>;
}

/**
 * A 24-hour micro-histogram for the busiest-hour figure: the same
 * `hourTotals` the Time of day chart draws below, restated as a glanceable
 * strip. It uses the ranked-bar grammar (`--primary`, the peak at full
 * strength, every other hour at 0.45, an empty hour as a hairline). Purely a
 * restatement of numbers already printed, hence aria-hidden.
 */
export function HourSpark({ hours }: { readonly hours: readonly number[] }) {
  const peak = Math.max(...hours, 0);
  if (peak === 0) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-16 shrink-0 items-end gap-px sm:w-24"
    >
      {hours.map((count, hour) => (
        <span
          key={hour}
          className={cn("flex-1 rounded-[1px]", count === 0 && "bg-border")}
          style={{
            backgroundColor: count === 0 ? undefined : "var(--primary)",
            opacity: count === 0 || count === peak ? 1 : 0.45,
            height:
              count === 0
                ? "1px"
                : `${String(Math.max(16, Math.round((count / peak) * 100)))}%`,
          }}
        />
      ))}
    </span>
  );
}

export interface CaseFigure {
  readonly key: string;
  readonly label: ReactNode;
  /** A number eases to its value; a string is printed as is. */
  readonly value: number | string;
  /** False when the value is a word for "nothing of that shape" (e.g. "No
   *  dated activity"), so it reads as a muted state, not a recorded figure. */
  readonly recorded: boolean;
  /** What the figure counts, in words. Every figure carries one. */
  readonly detail: string;
  /** A small restatement drawn at the figure's end (the hour strip). */
  readonly aside?: ReactNode;
}

/**
 * The Case figures: one `MetricBand` of recorded readings — the headline
 * counts first, then the highlights. Each is a plain reading of a number the
 * page already computed — never a Candidate, never a new query.
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
          const value =
            typeof item.value === "number" ? (
              <CountValue count={item.value} />
            ) : (
              item.value
            );
          return (
            <MetricBandItem
              key={item.key}
              label={item.label}
              value={
                item.aside === undefined ? (
                  value
                ) : (
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 truncate">{value}</span>
                    {item.aside}
                  </span>
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
            <FieldCell field={field} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Top sites
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

function TopSiteRow({
  site,
  index,
  peak,
  favicon,
  registerItem,
  onOpen,
}: {
  readonly site: TopSite;
  readonly index: number;
  readonly peak: number;
  readonly favicon: string | null | undefined;
  readonly registerItem?: (index: number, element: HTMLElement | null) => void;
  readonly onOpen?: (domain: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  const domain = domainOf(site.url);
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-2.5">
        <SiteMark domain={domain} favicon={favicon} />
        <span className={cn(typeClass("body"), "truncate text-foreground")}>
          {domain}
        </span>
      </span>
      <ShareBar
        fraction={peak === 0 ? 0 : site.count / peak}
        peak={peak > 0 && site.count === peak}
      />
      <span
        className={cn(
          typeClass("body"),
          "w-8 text-right text-foreground tabular-nums",
        )}
      >
        {site.count.toLocaleString("en-US")}
      </span>
    </>
  );
  const rowClass =
    "relative grid h-9 w-full grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-4 rounded-lg px-3 text-left";
  if (onOpen === undefined) {
    return <div className={rowClass}>{content}</div>;
  }
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => {
        onOpen(domain);
      }}
      aria-label={`${domain}, ${site.count.toLocaleString("en-US")} saved visits — open in Sites`}
      className={cn(
        rowClass,
        "cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-focus-ring",
      )}
    >
      {content}
    </button>
  );
}

/**
 * The Top sites list: one fluid hover highlight glides between the rows;
 * clicking a row is the same jump the panel's own link makes, pre-aimed at
 * that host on the Sites page.
 */
export function TopSitesList({
  sites,
  favicons,
  onOpenSite,
}: {
  readonly sites: readonly TopSite[];
  readonly favicons: ReadonlyMap<string, string | null>;
  readonly onOpenSite?: (domain: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(containerRef, { axis: "y" });
  const peak = Math.max(...sites.map((site) => site.count), 0);
  if (sites.length === 0) {
    return (
      <EmptyRows
        icon={Globe}
        message="No saved site visits are recorded in this Case."
        className="flex-1 justify-center py-8"
      />
    );
  }
  const clickable = onOpenSite !== undefined;
  return (
    <div
      ref={containerRef}
      className="relative flex flex-1 flex-col justify-center px-1 pb-2"
      {...(clickable ? hover.handlers : {})}
    >
      <FluidHoverHighlight
        hover={hover}
        hidden={!clickable}
        className="rounded-lg"
      />
      {sites.map((site, index) => (
        <TopSiteRow
          key={site.url}
          site={site}
          index={index}
          peak={peak}
          favicon={favicons.get(domainOf(site.url))}
          registerItem={clickable ? hover.registerItem : undefined}
          onOpen={onOpenSite}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent downloads
// ---------------------------------------------------------------------------

/** One recorded download: the plain filename (when one can be read from the
 *  path, with the full recorded path on hover) over its source URL and start
 *  time, each the exact Field State text every list page uses. */
function DownloadRow({ download }: { readonly download: Finding }) {
  const name = downloadFileName(download.fields.targetPath);
  return (
    <li className="flex items-start gap-3 border-t border-border py-3 first:border-t-0 first:pt-1">
      <IconTile icon={FileDown} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {name === null ? (
          <FieldCell field={download.fields.targetPath} />
        ) : (
          <Tooltip
            content={
              <span className="font-mono break-all">
                {downloadPath(download.fields.targetPath)}
              </span>
            }
            className="max-w-[360px] whitespace-normal"
          >
            <p
              className={cn(typeClass("body"), "truncate text-foreground")}
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              {name}
            </p>
          </Tooltip>
        )}
        <FieldCell field={download.fields.originalUrl} />
        <TimeText field={download.fields.startTime} />
      </div>
    </li>
  );
}

function downloadPath(field: FieldState | undefined): string {
  return field !== undefined &&
    field.state === "value" &&
    typeof field.value === "string"
    ? field.value
    : "";
}

export function DownloadsList({
  downloads,
}: {
  readonly downloads: readonly Finding[];
}) {
  if (downloads.length === 0) {
    return (
      <EmptyRows
        icon={FileDown}
        message="No saved downloads are recorded in this Case."
        className="flex-1 justify-center py-8"
      />
    );
  }
  return (
    <ul className="scroll-fade flex max-h-[284px] flex-col overflow-y-auto px-4 pb-3">
      {downloads.map((download, index) => (
        <DownloadRow
          key={`${download.profile}-${String(index)}`}
          download={download}
        />
      ))}
    </ul>
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
      <div className="flex flex-col gap-2 px-4 pt-4 pb-2">
        <Skeleton className="h-4 w-28 rounded-md" />
        <Skeleton className="h-3.5 w-48 rounded-md" />
      </div>
      <div className={cn("px-4 pt-2 pb-4", bodyClassName)}>
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    </Panel>
  );
}

/**
 * The page's skeleton, laid out on the real page's grid at (no more than)
 * its blocks' sizes — masthead, the eight-figure band, the first panel row —
 * so the `reveal-swap` hand-over never shifts layout. A live status region,
 * so the load is announced rather than silent.
 */
export function LoadingOverview({
  className,
}: {
  readonly className?: string;
}) {
  return (
    <div
      role="status"
      aria-label="Loading overview"
      className={cn("flex flex-col gap-5", className)}
    >
      <div className="flex items-center gap-4 pt-2">
        <Skeleton className="size-12 rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56 rounded-md" />
          <Skeleton className="h-4 w-72 max-w-[60vw] rounded-md" />
        </div>
      </div>
      <Panel className="overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((key) => (
            <div
              key={key}
              className="flex flex-col gap-2 px-4 py-3 shadow-[-1px_0_0_0_var(--border),0_-1px_0_0_var(--border)] sm:px-5 sm:py-3.5"
            >
              <Skeleton className="h-3 w-20 rounded-md" />
              <Skeleton className="h-5 w-24 rounded-md" />
              <Skeleton className="h-3 w-32 max-w-full rounded-md" />
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
