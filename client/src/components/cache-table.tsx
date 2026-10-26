/**
 * The Cache page's entry lists (one per Commit State, split from the one
 * mixed read) and how an entry is read: its stored size, its integrity
 * checks and the resource its key names.
 */

import { Button } from "@/components/ui/button";
import { SizeProvider, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { Finding } from "../types.js";
import { cacheResourceHost, cacheSiteKey } from "./cache-keys.js";
import { EmptyRows } from "./data-table.js";
import { EvidenceDot, type EvidenceState } from "./evidence.js";
import {
  FieldCell,
  SiteAvatar,
  StateWord,
  profileLabel,
} from "./finding-fields.js";
import {
  ErrorRows,
  ListFooter,
  ListStatus,
  listStatusMessage,
  LoadingRows,
  RevealSwap,
} from "./list-states.js";
import { TimeCell } from "./page-kit.js";
import { SiteHostLink } from "./host-link.js";
import { fieldBool, fieldInteger, fieldText } from "../field-readers.js";
import { ResponsiveRows, type RowColumn } from "./responsive-rows.js";
import { formatBytes } from "./bytes.js";

/**
 * The payload size an entry stores on disk, in bytes, or `null` when the
 * evidence does not carry it. Prefers the whole-entry figure the index
 * records (`entrySizeBytes`); falls back to the recovered body stream
 * (`stream1Size`). A field that is `absent`/`unavailable`/non-integer returns
 * `null` and is never coerced to zero, so a missing size never quietly shrinks
 * a total.
 */
export function entryBytes(row: Finding): number | null {
  return (
    fieldInteger(row.fields.entrySizeBytes) ??
    fieldInteger(row.fields.stream1Size)
  );
}

/** True when this entry carries an explicit "verified" integrity signal —
 *  a valid key hash and (when present) a valid stream-1 CRC. A missing signal
 *  is not verified; the table words the three apart, this only drives the
 *  summary share. */
export function integrityVerified(row: Finding): boolean {
  const keyHashValid = fieldBool(row.fields.keyHashValid) === true;
  const crc = fieldBool(row.fields.stream1Crc32Valid);
  return keyHashValid && crc !== false;
}

/**
 * The integrity word for the table, from the two recorded checks' own
 * states: "failed" when either check recorded false; "verified" when the key
 * hash recorded true; "CRC verified" when only the stream-1 CRC recorded a
 * result (true); the key-hash field's own word ("unavailable" and its
 * reason, or its raw value) when it holds no verdict; "not recorded" only
 * when neither check was recorded at all. Every dot is a neutral ring
 * (absent for not recorded): amber means "recovered" on this page, not a
 * failed check, so the word alone carries the verdict.
 */
function IntegrityCell({ row }: { readonly row: Finding }) {
  const keyHashField = row.fields.keyHashValid;
  const keyHashValid = fieldBool(keyHashField);
  const crc = fieldBool(row.fields.stream1Crc32Valid);
  const word = (label: string, state: EvidenceState) => (
    <span className="inline-flex items-center gap-1.5">
      <EvidenceDot state={state} />
      {label}
    </span>
  );
  if (keyHashValid === false || crc === false) {
    return word("failed", "neutral");
  }
  if (keyHashValid === true) {
    return word("verified", "neutral");
  }
  if (keyHashField !== undefined && keyHashField.state !== "absent") {
    // Unavailable, (empty), or a value that is no verdict: as recorded.
    return <FieldCell field={keyHashField} />;
  }
  if (crc === true) {
    return word("CRC verified", "neutral");
  }
  const crcField = row.fields.stream1Crc32Valid;
  if (crcField !== undefined && crcField.state !== "absent") {
    return <FieldCell field={crcField} />;
  }
  return word("not recorded", "absent");
}

/**
 * The resource: the key's host over the cached key (mono, muted, a step
 * smaller), so the list scans by site and still shows the exact key. In the
 * table the host links to Sites when Sites lists it. A key that names no
 * URL host keeps the key alone - its value or its own state word
 * ("unavailable" and the reason).
 */
function ResourceCell({
  row,
  wide = true,
}: {
  readonly row: Finding;
  /** The table cell (avatar and host link); off in a phone card. */
  readonly wide?: boolean;
}) {
  const size = useSize();
  const host = cacheResourceHost(row);
  if (host === null) {
    return <FieldCell field={row.fields.key} mono />;
  }
  const lines = (
    <span className="flex min-w-0 flex-col">
      {wide ? (
        <SiteHostLink
          host={cacheSiteKey(row)}
          className={cn(
            size.type.body,
            "max-w-full self-start truncate text-foreground",
          )}
        >
          {host}
        </SiteHostLink>
      ) : (
        <span
          className={cn(size.type.body, "block truncate text-foreground")}
          title={host}
        >
          {host}
        </span>
      )}
      <SizeProvider size="compact">
        <span className="block min-w-0 text-muted-foreground">
          <FieldCell field={row.fields.key} mono />
        </span>
      </SizeProvider>
    </span>
  );
  if (!wide) {
    return lines;
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <SiteAvatar host={host} />
      <span className="min-w-0 flex-1">{lines}</span>
    </span>
  );
}

const RESOURCE_COLUMN: RowColumn<Finding> = {
  key: "resource",
  header: "Resource",
  className: "max-w-[400px] min-w-[240px]",
  stack: "title",
  cell: (row) => <ResourceCell row={row} />,
  stackedCell: (row) => <ResourceCell row={row} wide={false} />,
};

const SIZE_COLUMN: RowColumn<Finding> = {
  key: "size",
  header: "Size",
  // Fixed widths on the short columns (Resource takes the rest), so a
  // range, a filter or the Integrity column leaving never shifts them.
  className: "w-[96px] text-right whitespace-nowrap tabular-nums",
  cell: (row) => {
    const bytes = entryBytes(row);
    return bytes === null ? (
      <FieldCell field={row.fields.entrySizeBytes} />
    ) : (
      <span title={`${bytes.toLocaleString("en-US")} bytes`}>
        {formatBytes(bytes)}
      </span>
    );
  },
};

const LAST_USED_COLUMN: RowColumn<Finding> = {
  key: "last-used",
  header: "Last used (UTC)",
  label: "Last used",
  className: "w-[184px] whitespace-nowrap",
  stack: "lead",
  cell: (row) => <TimeCell field={row.fields.lastUsed} />,
};

const PROFILE_COLUMN: RowColumn<Finding> = {
  key: "profile",
  header: "Profile",
  className: "w-[136px] whitespace-nowrap",
  cell: (row) => profileLabel(row.profile),
};

const integrityColumn = (stack: "aside" | "meta"): RowColumn<Finding> => ({
  key: "integrity",
  header: "Integrity",
  className: "w-[136px] whitespace-nowrap",
  stack,
  cell: (row) => <IntegrityCell row={row} />,
});

const STATE_COLUMN: RowColumn<Finding> = {
  key: "state",
  header: "State",
  className: "w-[184px]",
  stack: "aside",
  cell: (row) => <StateWord state={row.commitState} />,
};

/** Saved entries: no State column (every row is saved), so the integrity
 *  word holds the stacked row's state slot. Recovered entries: the State
 *  word does, and integrity joins the meta line. */
const SAVED_COLUMNS: readonly RowColumn<Finding>[] = [
  RESOURCE_COLUMN,
  SIZE_COLUMN,
  LAST_USED_COLUMN,
  integrityColumn("aside"),
  PROFILE_COLUMN,
];

/** Saved entries that all read "verified": the Integrity column would say
 *  the same word on every row, and the "Integrity verified 100%" figure
 *  already does, so the list leaves it out (the sheet keeps both checks). */
const SAVED_COLUMNS_ALL_VERIFIED: readonly RowColumn<Finding>[] =
  SAVED_COLUMNS.filter((column) => column.key !== "integrity");

const RECOVERED_COLUMNS: readonly RowColumn<Finding>[] = [
  RESOURCE_COLUMN,
  SIZE_COLUMN,
  LAST_USED_COLUMN,
  integrityColumn("meta"),
  PROFILE_COLUMN,
  STATE_COLUMN,
];

/** A row's identity within its list: its source row (the Commit State
 *  keeps a WAL copy of a saved entry apart). Stable across a sort or a
 *  filter, so rows keep their memoised render. */
const entryKey = (row: Finding) =>
  `${row.commitState}:${row.profile}:${row.provenance.manifestPath ?? ""}:${row.provenance.table ?? ""}:${row.provenance.rowId ?? fieldText(row.fields.entryHash) ?? ""}`;

const entryLabel = (row: Finding) => {
  const host = cacheResourceHost(row);
  return `Open cache entry detail${host === null ? "" : ` for ${host}`}`;
};

function EntriesTable({
  rows,
  recovered,
  allVerified,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly recovered: boolean;
  /** Every saved entry of the list reads "verified". */
  readonly allVerified: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  return (
    <ResponsiveRows
      rows={rows}
      columns={
        recovered
          ? RECOVERED_COLUMNS
          : allVerified
            ? SAVED_COLUMNS_ALL_VERIFIED
            : SAVED_COLUMNS
      }
      rowKey={entryKey}
      rowLabel={entryLabel}
      onSelect={onSelect}
      tableClassName="tabular-nums"
    />
  );
}

/**
 * One list (saved or recovered) of the loaded cache: its loading rows, the
 * read's error, its empty state, the rows, and — only while a filter
 * narrows it or the read stopped at its cap — a footer saying so. The whole
 * cache is one capped read, so there is no per-list "Load more".
 */
export function EntryList({
  rows,
  inLens,
  visible,
  noun,
  loading,
  draining,
  error,
  complete,
  filteredMessage,
  onRetry,
  onSelect,
  onClearFilters,
}: {
  readonly rows: readonly Finding[];
  /** The rows in the lens (range, profiles): the base the tab counts and
   *  the footer reads "3 of 12" against. */
  readonly inLens: number;
  readonly visible: readonly Finding[];
  readonly noun: "saved" | "recovered";
  readonly loading: boolean;
  /** The rest of the cache is still being read. */
  readonly draining: boolean;
  readonly error: string | null;
  readonly complete: boolean;
  /** What a filtered-empty list says ("No saved cache entries last used
   *  12 Mar 2024."). */
  readonly filteredMessage: string;
  readonly onRetry: () => void;
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
}) {
  if (error !== null) {
    return (
      <ErrorRows
        title="The cache entries could not be loaded."
        message={error}
        onRetry={onRetry}
      />
    );
  }
  const filtered = visible.length !== rows.length;
  return (
    <>
      <ListStatus
        message={listStatusMessage({
          noun: { one: `${noun} cache entry`, many: `${noun} cache entries` },
          loading,
          failed: false,
          shown: visible.length,
          total: inLens,
          more: !complete,
          filtered,
        })}
      />
      <RevealSwap
        loading={loading}
        skeleton={
          <LoadingRows
            label={`Loading ${noun} cache entries`}
            announce={false}
          />
        }
      >
        {visible.length === 0 ? (
          <EmptyRows
            message={
              filtered
                ? filteredMessage
                : noun === "saved"
                  ? "No saved cache entries. Every loaded entry was recovered."
                  : "No cache entries were recovered."
            }
            action={
              filtered ? (
                <Button
                  variant="tertiary"
                  size="compact"
                  onClick={onClearFilters}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EntriesTable
            rows={visible}
            recovered={noun === "recovered"}
            // Read over the whole list, not the filtered rows, so a filter
            // never adds or drops the column.
            allVerified={rows.length > 0 && rows.every(integrityVerified)}
            onSelect={onSelect}
          />
        )}
      </RevealSwap>
      {loading || visible.length === 0 ? null : (
        <ListFooter
          shown={visible.length}
          total={inLens}
          more={!complete && !draining}
          draining={draining}
        />
      )}
    </>
  );
}
