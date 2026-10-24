/**
 * The Overview's building blocks, composed from Fluid Functionalism parts:
 * `Panel` surfaces, FF `Button` jump links, type roles and weight tokens,
 * one `useFluidHover` highlight for the Top sites list, and springs for the
 * little motion there is (share bars, figure counts).
 */
import { ArrowUpRight, FileDown, UserRound } from "lucide-react";
import { animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  Panel,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@/components/panel";
import { MaybeFieldStateText } from "@/components/field-state";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { fontWeights } from "@/lib/font-weight";
import { typeClass } from "@/lib/size-context";
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
// Section header
// ---------------------------------------------------------------------------

/**
 * A panel's header: title (with any qualifier badges beside it) over its
 * description, and an optional jump link on the right that opens the section
 * the panel summarizes. The link is an FF ghost button — the panel itself
 * stays a plain reading surface (values can be selected, chart tooltips
 * hovered) rather than one big click target.
 */
export function SectionHeader({
  title,
  description,
  badges,
  linkLabel,
  onOpen,
}: {
  readonly title: string;
  readonly description: ReactNode;
  readonly badges?: ReactNode;
  readonly linkLabel?: string;
  readonly onOpen?: () => void;
}) {
  return (
    <PanelHeader className="flex-nowrap">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <PanelTitle>{title}</PanelTitle>
          {badges}
        </div>
        <PanelDescription>{description}</PanelDescription>
      </div>
      {linkLabel !== undefined && onOpen !== undefined ? (
        <Button
          variant="ghost"
          size="compact"
          trailingIcon={ArrowUpRight}
          onClick={onOpen}
          aria-label={`Open ${linkLabel}`}
          className="-my-1 -mr-2"
        >
          {linkLabel}
        </Button>
      ) : null}
    </PanelHeader>
  );
}

// ---------------------------------------------------------------------------
// Masthead
// ---------------------------------------------------------------------------

/**
 * Eases a figure to its true value on mount and whenever the value changes
 * (a range edit re-runs it, so the masthead visibly re-counts). It rides
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

/** One figure in the masthead readout: the number, then what it counts. */
function Figure({
  label,
  value,
  note,
}: {
  readonly label: ReactNode;
  readonly value: string;
  readonly note?: string;
}) {
  return (
    // The term reads after its number, so the column is reversed: the
    // markup keeps `dt` before `dd` for assistive technology.
    <div className="flex min-w-0 flex-col-reverse justify-end gap-1">
      <dt
        className={cn(
          typeClass("caption"),
          "flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-muted-foreground",
        )}
      >
        <span className="shrink-0 text-foreground">{label}</span>
        {note === undefined ? null : (
          <span className="max-w-full truncate" title={note}>
            {note}
          </span>
        )}
      </dt>
      <dd
        className={cn(typeClass("display"), "text-foreground tabular-nums")}
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {value}
      </dd>
    </div>
  );
}

/** A count that eases to its value; the label stays put. */
function CountFigure({
  label,
  count,
  note,
}: {
  readonly label: ReactNode;
  readonly count: number;
  readonly note?: string;
}) {
  const shown = useCountUp(count);
  return (
    <Figure label={label} value={shown.toLocaleString("en-US")} note={note} />
  );
}

/**
 * The Case masthead: whose browser this is, in the display role, and the
 * page's four headline counts. It sits on the page substrate like every
 * other page header — no saturated slab — so the first framed surface the
 * examiner meets is evidence.
 */
export function Masthead({
  subjectName,
  meta,
  rangeNote,
  picker,
  visits,
  activeDays,
  readable,
  profiles,
}: {
  readonly subjectName: string | null;
  readonly meta: string;
  readonly rangeNote: string | null;
  readonly picker: ReactNode;
  readonly visits: number;
  readonly activeDays: number;
  readonly readable: {
    readonly label: ReactNode;
    readonly value: string;
    readonly note?: string;
  };
  readonly profiles: readonly string[];
}) {
  return (
    <header aria-label="Case masthead" className="flex flex-col gap-7 pt-2">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-hover text-muted-foreground"
          >
            <UserRound size={20} strokeWidth={1.5} />
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
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4 lg:flex lg:flex-wrap lg:gap-x-14">
        <CountFigure label="Page visits" count={visits} />
        <CountFigure label="Active days" count={activeDays} />
        <Figure
          label={readable.label}
          value={readable.value}
          note={readable.note}
        />
        <Figure
          label={profiles.length === 1 ? "Profile" : "Profiles"}
          value={String(profiles.length)}
          note={profiles.length === 0 ? undefined : profiles.join(", ")}
        />
      </dl>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

/**
 * A 24-hour micro-histogram for the busiest-hour highlight: the same
 * `hourTotals` the Time of day chart draws below, restated as a glanceable
 * strip. Purely a restatement of numbers already printed, hence aria-hidden.
 */
export function HourSpark({ hours }: { readonly hours: readonly number[] }) {
  const peak = Math.max(...hours, 0);
  if (peak === 0) {
    return null;
  }
  return (
    <div aria-hidden="true" className="flex h-5 w-24 items-end gap-px">
      {hours.map((count, hour) => (
        <span
          key={hour}
          className={cn(
            "flex-1 rounded-[1px]",
            count === peak
              ? "bg-foreground"
              : count > 0
                ? "bg-muted-foreground opacity-50"
                : "bg-border",
          )}
          style={{
            height:
              count === 0
                ? "1px"
                : `${String(Math.max(16, Math.round((count / peak) * 100)))}%`,
          }}
        />
      ))}
    </div>
  );
}

export interface Highlight {
  readonly label: string;
  readonly value: string;
  /** False when the value is the "nothing of that shape" wording, so it reads
   *  as a muted state rather than as a recorded figure. */
  readonly recorded: boolean;
  readonly note: string;
  readonly aside?: ReactNode;
}

/**
 * The highlights band: one Panel, four readings with hairlines between them.
 * Each is a plain reading of a recorded number the page already computed —
 * never a Candidate, never a new query.
 */
export function HighlightsBand({
  items,
}: {
  readonly items: readonly Highlight[];
}) {
  return (
    <Panel role="group" aria-label="Highlights" className="overflow-hidden">
      <div className="-mr-px -mb-px grid grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex min-w-0 flex-col gap-1 border-r border-b border-border px-4 py-4"
          >
            <span className={cn(typeClass("caption"), "text-muted-foreground")}>
              {item.label}
            </span>
            <div className="flex h-[22px] min-w-0 items-center justify-between gap-3">
              <span
                className={cn(
                  typeClass("title"),
                  "truncate tabular-nums",
                  item.recorded ? "text-foreground" : "text-muted-foreground",
                )}
                style={{ fontVariationSettings: fontWeights.semibold }}
              >
                {item.value}
              </span>
              {item.aside === undefined ? null : (
                <span className="shrink-0">{item.aside}</span>
              )}
            </div>
            <span
              className={cn(
                typeClass("caption"),
                "truncate text-muted-foreground",
              )}
              title={item.note}
            >
              {item.note}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

/**
 * The subject readout: plain-language labels against the Metadata values,
 * each rendered through the shared Field State text, so `absent` and
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
            <MaybeFieldStateText field={field} truncate />
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
  isTop,
  favicon,
  registerItem,
  onOpen,
}: {
  readonly site: TopSite;
  readonly index: number;
  readonly peak: number;
  readonly isTop: boolean;
  readonly favicon: string | null | undefined;
  readonly registerItem?: (index: number, element: HTMLElement | null) => void;
  readonly onOpen?: (domain: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  const domain = domainOf(site.url);
  const share = peak === 0 ? 0 : site.count / peak;
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-2.5">
        <SiteMark domain={domain} favicon={favicon} />
        <span className={cn(typeClass("body"), "truncate text-foreground")}>
          {domain}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="h-1 w-full overflow-hidden rounded-full bg-hover"
      >
        <motion.span
          className={cn(
            "block h-full w-full rounded-full",
            isTop ? "bg-foreground" : "bg-muted-foreground opacity-60",
          )}
          style={{ originX: 0 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: share }}
          transition={spring.slow}
        />
      </span>
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
      aria-label={`${domain}, ${site.count.toLocaleString("en-US")} recorded visits — open in Sites`}
      className={cn(
        rowClass,
        "cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
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
      <p
        className={cn(
          typeClass("body"),
          "flex min-h-[120px] flex-1 items-center justify-center px-4 pb-4 text-muted-foreground",
        )}
      >
        No visited sites recorded.
      </p>
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
          isTop={index === 0}
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
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover text-muted-foreground"
      >
        <FileDown size={16} strokeWidth={1.5} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {name === null ? (
          <MaybeFieldStateText field={download.fields.targetPath} truncate />
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
        <MaybeFieldStateText field={download.fields.originalUrl} truncate />
        <MaybeFieldStateText field={download.fields.startTime} />
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
      <p
        className={cn(
          typeClass("body"),
          "flex min-h-[120px] flex-1 items-center justify-center px-4 pb-4 text-muted-foreground",
        )}
      >
        No downloads recorded.
      </p>
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
 * its blocks' sizes, so the `reveal-swap` hand-over never shifts layout.
 */
export function LoadingOverview({
  className,
}: {
  readonly className?: string;
}) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-6", className)}>
      <div className="flex flex-col gap-7 pt-2">
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-xl" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-56 rounded-md" />
            <Skeleton className="h-4 w-72 max-w-[60vw] rounded-md" />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-14 gap-y-5">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="flex flex-col gap-2">
              <Skeleton className="h-7 w-16 rounded-md" />
              <Skeleton className="h-3 w-24 rounded-md" />
            </div>
          ))}
        </div>
      </div>
      <Panel className="overflow-hidden">
        <div className="-mr-px -mb-px grid grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <div
              key={key}
              className="flex flex-col gap-2 border-r border-b border-border px-4 py-4"
            >
              <Skeleton className="h-3 w-20 rounded-md" />
              <Skeleton className="h-4 w-28 rounded-md" />
              <Skeleton className="h-3 w-32 rounded-md" />
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
