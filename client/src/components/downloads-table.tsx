/**
 * The Downloads lists: columns (file kind first), sort controls, the
 * loading skeleton and one list body. Split out of `downloads-page.tsx`.
 */
import { useMemo } from "react";

import { EvidenceDot } from "@/components/evidence";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Tooltip as FluidTooltip } from "@/components/ui/tooltip";
import { SortNewestIcon, SortOldestIcon } from "@/lib/app-icons";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { siteKeyOf } from "../related.js";
import { rowRefOf } from "../router.js";
import type { FieldState, Finding } from "../types.js";
import { EmptyRows } from "./data-table.js";
import {
  FieldCell,
  fieldText,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterField } from "./filters.js";
import {
  SiteHostLink,
  useSiteHosts,
  type SiteHostLookup,
} from "./history-host-link.js";
import { Term } from "./term.js";
import { ListBlock } from "./list-states.js";
import {
  ResponsiveRows,
  TimeCell,
  TypeLabel,
  formatBytes,
  plural,
  type RowColumn,
} from "./page-kit.js";
import {
  type FileKind,
  KIND_META,
  SORT_KEYS,
  SORT_LABELS,
  DIRECTION_WORDS,
  type SortState,
  type DownloadRow,
  stateLabel,
  isUnfinished,
} from "./downloads-model.js";

/* --------------------------------- table ---------------------------------- */

/**
 * The download outcome in words, beside a neutral mark: an outcome is no
 * evidence state, so it never borrows an evidence hue (amber would read as
 * "recovered" beside the State column). "Complete" sits muted (the ordinary
 * outcome); the two unfinished outcomes read in the foreground. A value outside the known set passes through verbatim, and a state
 * Chrome did not record keeps its field's own word.
 */
export function DownloadState({
  field,
}: {
  readonly field: FieldState | undefined;
}) {
  const size = useSize();
  const state = fieldText(field);
  if (state === null) {
    return <FieldCell field={field} />;
  }
  const unfinished = isUnfinished(state);
  return (
    <span
      className={cn(
        size.type.caption,
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        unfinished ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <EvidenceDot state="neutral" />
      {stateLabel(state)}
    </span>
  );
}

/**
 * The size, never overstated: the bytes Chrome recorded as received, with
 * the expected size beside them while they fall short ("9.4 of 28.2 MB");
 * the expected size alone says so ("28.2 MB expected"); neither recorded
 * reads as the received field's own word.
 */
export function DownloadSize({ row }: { readonly row: DownloadRow }) {
  const { received, expected } = row;
  if (received === null) {
    return expected === null ? (
      <FieldCell field={row.finding.fields.receivedBytes} />
    ) : (
      <span
        className="whitespace-nowrap"
        title={`${expected.toLocaleString("en-US")} bytes expected; no received bytes recorded`}
      >
        {formatBytes(expected)}{" "}
        <span className="text-muted-foreground">expected</span>
      </span>
    );
  }
  if (expected === null || received >= expected) {
    return (
      <span
        className="whitespace-nowrap"
        title={`${received.toLocaleString("en-US")} bytes received`}
      >
        {formatBytes(received)}
      </span>
    );
  }
  const shown = formatBytes(received);
  const of = formatBytes(expected);
  // One unit when both share it: "9.4 of 28.2 MB".
  const unit = /\s\S+$/.exec(of)?.[0];
  const lead =
    unit !== undefined && shown.endsWith(unit)
      ? shown.slice(0, -unit.length)
      : shown;
  return (
    <span
      className="whitespace-nowrap"
      title={`${received.toLocaleString("en-US")} of ${expected.toLocaleString("en-US")} bytes received`}
    >
      {lead} <span className="text-muted-foreground">of {of}</span>
    </span>
  );
}

/** The source: the host with its avatar when the URL parses (linked to
 *  Sites when Sites lists that exact host, table only), the raw URL
 *  (monospace) when it does not, and the URL field's state word when none
 *  was recorded. */
export function Source({
  row,
  avatar,
  sites = null,
}: {
  readonly row: DownloadRow;
  readonly avatar: boolean;
  /** Sites' host list (`useSiteHosts`); null links nothing. */
  readonly sites?: SiteHostLookup;
}) {
  if (row.host === null) {
    return row.sourceUrl === null ? (
      <FieldCell field={row.finding.fields.originalUrl} />
    ) : (
      <span className="block truncate font-mono" title={row.sourceUrl}>
        {row.sourceUrl}
      </span>
    );
  }
  const key = siteKeyOf(row.sourceUrl);
  const linked = key !== null && sites !== null && sites(key);
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {avatar ? <SiteAvatar host={row.host} /> : null}
      <span className="truncate" title={row.sourceUrl ?? row.host}>
        {linked ? (
          <SiteHostLink siteKey={key}>{row.host}</SiteHostLink>
        ) : (
          row.host
        )}
      </span>
    </span>
  );
}

/** The download lists' columns, and where each sits in the stacked card on
 *  a phone: Type and the outcome (saved) or the State word (recovered) on
 *  the first line, the file as the title, size · source · start under it. */
export function downloadColumns(
  recovered: boolean,
  sites: SiteHostLookup = null,
): readonly RowColumn<DownloadRow>[] {
  const columns: RowColumn<DownloadRow>[] = [
    {
      key: "type",
      header: "Type",
      // Fixed widths on every column but Source (it takes the rest), so a
      // range or a kind pick never shifts the columns.
      className: "w-[148px] whitespace-nowrap",
      stack: "lead",
      cell: (row) => <FileKindLabel kind={row.kind} />,
      stackedCell: (row) => KIND_META[row.kind].label,
    },
    {
      key: "file",
      header: "File",
      className: "w-[260px] max-w-[260px]",
      stack: "title",
      cell: (row) =>
        row.name === null ? (
          <FieldCell field={row.finding.fields.targetPath} />
        ) : (
          <span
            className="block truncate text-foreground"
            title={row.path ?? row.name}
          >
            {row.name}
          </span>
        ),
    },
    {
      key: "size",
      header: (
        <Term label="Size">
          The bytes Chrome recorded as received. While a download fell short,
          the size it expected follows (&quot;9.4 of 28.2 MB&quot;).
        </Term>
      ),
      label: "Size",
      className: "w-[136px] text-right whitespace-nowrap tabular-nums",
      cell: (row) => <DownloadSize row={row} />,
    },
    {
      key: "source",
      header: "Source",
      className: "max-w-[320px]",
      cell: (row) => <Source row={row} avatar sites={sites} />,
      stackedCell: (row) => <Source row={row} avatar={false} />,
    },
    {
      key: "started",
      header: "Started (UTC)",
      label: "Started",
      className: "w-[184px] whitespace-nowrap",
      cell: (row) => <TimeCell field={row.finding.fields.startTime} />,
    },
    {
      key: "outcome",
      header: "Outcome",
      className: "w-[112px] whitespace-nowrap",
      stack: recovered ? "meta" : "aside",
      cell: (row) => <DownloadState field={row.finding.fields.state} />,
    },
  ];
  if (recovered) {
    columns.push({
      key: "state",
      header: "State",
      className: "w-[184px] whitespace-nowrap",
      stack: "aside",
      cell: (row) => <StateWord state={row.finding.commitState} />,
    });
  }
  return columns;
}

/** A download's stable key: its row reference, so a sort, a filter or a
 *  range re-renders no kept row. */
function downloadKey(row: DownloadRow, index: number): string {
  return rowRefOf(row.finding) ?? `${row.finding.commitState}-${String(index)}`;
}

function downloadLabel(row: DownloadRow): string {
  return `Open download row detail: ${row.name ?? "download"}`;
}

/** The file kind, worded, with its icon. */
export function FileKindLabel({ kind }: { readonly kind: FileKind }) {
  const meta = KIND_META[kind];
  return <TypeLabel icon={meta.icon} label={meta.label} />;
}

/** Sort and direction for both lists, as on History: an FF Select and a
 *  direction toggle whose tooltip says the order in words. */
export function SortControls({
  sort,
  onSort,
}: {
  readonly sort: SortState;
  readonly onSort: (sort: SortState) => void;
}) {
  const descending = sort.dir === "desc";
  const words = DIRECTION_WORDS[sort.key];
  const DirectionIcon = descending ? SortNewestIcon : SortOldestIcon;
  const flip = `Sorted ${descending ? words.desc : words.asc}. Switch to ${
    descending ? words.asc : words.desc
  }`;
  return (
    <FilterField label="Sort" htmlFor="downloads-sort">
      <Select
        value={sort.key}
        onValueChange={(value) => {
          const key = SORT_KEYS.find((candidate) => candidate === value);
          if (key !== undefined) {
            onSort({
              key,
              dir: key === "file" || key === "type" ? "asc" : "desc",
            });
          }
        }}
      >
        <SelectTrigger id="downloads-sort" className="min-w-[120px]" />
        <SelectContent>
          {SORT_KEYS.map((key, index) => (
            <SelectItem key={key} index={index} value={key}>
              {SORT_LABELS[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FluidTooltip content={flip}>
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label={flip}
          onClick={() => {
            onSort({ key: sort.key, dir: descending ? "asc" : "desc" });
          }}
        >
          <DirectionIcon />
        </Button>
      </FluidTooltip>
    </FilterField>
  );
}

/* --------------------------------- loading --------------------------------- */

/** The saved read in flight: how far the cursor walk has got, over
 *  placeholders at the size of the blocks they stand in for. */
export function DownloadsLoading({ pages }: { readonly pages: number }) {
  const size = useSize();
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-label="Loading downloads"
    >
      <p
        className={cn(size.type.caption, "text-muted-foreground tabular-nums")}
        aria-live="polite"
      >
        {pages === 0
          ? "Reading saved downloads…"
          : `Reading saved downloads… ${plural(pages, "page", "pages")} loaded`}
      </p>
      <Skeleton className="h-[78px] rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-[300px] rounded-xl lg:col-span-2" />
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
    </div>
  );
}

/* ---------------------------------- lists --------------------------------- */

/** One of the two download lists (Saved or Recovered): its first read
 *  swapped in over a skeleton, a failed read with Retry, the rows or their
 *  empty state, and the footer. Rows are already narrowed and sorted. */
export function DownloadList({
  read,
  rows,
  recovered,
  filtered,
  onSelect,
  onClearFilters,
  filteredMessage,
}: {
  readonly read: {
    readonly rows: readonly Finding[] | null;
    readonly error: string | null;
    readonly retry: () => void;
  };
  readonly rows: readonly DownloadRow[];
  readonly recovered: boolean;
  readonly filtered: boolean;
  readonly onSelect: (row: DownloadRow) => void;
  readonly onClearFilters: () => void;
  /** What an empty filtered list says (the days, the kind…). */
  readonly filteredMessage?: string;
}) {
  const sites = useSiteHosts();
  const columns = useMemo(
    () => downloadColumns(recovered, sites),
    [recovered, sites],
  );
  return (
    <ListBlock
      list={{
        rows: read.rows ?? [],
        cursor: null,
        loading: read.rows === null && read.error === null,
        error: read.error,
        loadMore: () => undefined,
        retry: read.retry,
      }}
      noun={
        recovered
          ? { one: "recovered download", many: "recovered downloads" }
          : { one: "saved download", many: "saved downloads" }
      }
      shown={rows.length}
      filtered={filtered}
      filteredMessage={filteredMessage}
      onClearFilters={onClearFilters}
      skeletonRows={recovered ? 3 : 8}
      empty={
        <EmptyRows
          title={recovered ? "No recovered downloads" : "No saved downloads"}
          message={
            recovered
              ? "Neither the write-ahead log nor the rollback journal holds a download row."
              : "The History database holds no committed download rows."
          }
        />
      }
    >
      <ResponsiveRows
        rows={rows}
        columns={columns}
        rowKey={downloadKey}
        rowLabel={downloadLabel}
        onSelect={onSelect}
        tableClassName="min-w-[860px]"
      />
    </ListBlock>
  );
}
