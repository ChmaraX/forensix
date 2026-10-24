/**
 * The Form data page.
 *
 * Chrome's autofill store is the one evidence set that holds what the person
 * *typed* — names, e-mails, addresses, payment names, and free-text search
 * queries they let the browser remember. Two figures sit above the table:
 * how many entries were saved, and how many of them carry directly
 * identifying or financial data. The table's category chips group Chrome's
 * raw field names (EMAIL_ADDRESS, ADDRESS_HOME_ZIP, search-query, …) into the
 * classes an examiner reasons in (Payment, Identity, Contact, Address,
 * Searches, Other) by the fixed rule in `form-data.ts` — a restatement of
 * the recorded name, never a guess about the value.
 *
 * Payment-category values (card, CVC, IBAN, wallet, account fields) are
 * secrets: they read "value hidden" in the table until the page's "Show
 * values" switch is on, are left out of the search text while hidden, and
 * stay hidden in the row sheet behind its own Reveal.
 *
 * TYPE (the field type) is the first table column. Saved entries and entries
 * recovered from WAL / journal sidecars are separate server reads and
 * separate lists (the Saved / Recovered tabs); the figures count saved
 * entries only. No control here can start or rerun ingest, analysis, or
 * export.
 */
import { useCallback, useMemo, useState } from "react";

import { Panel } from "@/components/panel";
import { Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import { Tooltip } from "@/components/ui/tooltip";
import { ARTIFACT_ICONS, SearchIcon } from "@/lib/app-icons";

import type { QueryParameters } from "../api.js";
import type { ArtifactConfig, Finding } from "../types.js";
import {
  useCommitStateLists,
  type PaginatedList,
} from "../use-commit-state-lists.js";
import { EmptyRows } from "./data-table.js";
import {
  CommitStateSplit,
  ResponsiveRows,
  SectionPanel,
  TimeCell,
  type CommitView,
  type RowColumn,
} from "./page-kit.js";
import { FieldCell, fieldText, StateWord } from "./finding-fields.js";
import { FilterTextField } from "./filters.js";
import {
  categoryOf,
  FORM_DATA_CATEGORIES,
  isPaymentField,
  PAYMENT_KEY,
  PAYMENT_SECRET_FIELDS,
  type FormDataCategory,
} from "./form-data.js";
import { ListBlock, RevealSwap } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { HiddenValue, RowSheet, type SelectedRow } from "./row-sheet.js";
import { Term } from "./term.js";

/* ------------------------------ data reading ------------------------------ */

const AUTOFILL_PARAMETERS: QueryParameters = [
  ["sort", "last-used-time"],
  ["direction", "desc"],
  ["limit", "100"],
];

/** Rows read per list before the page stops following the cursor. The
 *  figures above the table are only honest if they cover the whole set, so
 *  every page is read rather than the first screen. */
const AUTOFILL_ROW_CAP = 6000;

/**
 * A field type read back for display: Chrome's SCREAMING_SNAKE_CASE names are
 * turned into "Email address", "Address home zip" so the table scans as
 * language, while the exact recorded name stays reachable byte-for-byte in the
 * row detail sheet. A raw HTML field name (search-query) is left as-is.
 */
function readableFieldType(fieldName: string | null): string | null {
  if (fieldName === null || fieldName === "") {
    return null;
  }
  if (!/^[A-Z0-9_]+$/.test(fieldName)) {
    return fieldName;
  }
  const words = fieldName.toLowerCase().split("_").filter(Boolean);
  if (words.length === 0) {
    return fieldName;
  }
  return words
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

/** True for a Payment entry that carries a recorded, non-empty value — the
 *  secret the page withholds until "Show values" is on. */
function holdsSecret(entry: Entry): boolean {
  return entry.category.key === PAYMENT_KEY && entry.value !== null;
}

/* ------------------------------ derived reads ----------------------------- */

interface Entry {
  readonly row: Finding;
  /** The recorded non-empty value, or null (see `row.fields.fieldValue`). */
  readonly value: string | null;
  readonly type: string | null;
  readonly category: FormDataCategory;
}

function toEntry(row: Finding): Entry {
  const type = fieldText(row.fields.fieldName);
  return {
    row,
    value: fieldText(row.fields.fieldValue),
    type: readableFieldType(type),
    category: categoryOf(type),
  };
}

/** Identity + Contact + Address + Payment: the entries that carry directly
 *  identifying or financial data, as opposed to search text. */
function sensitiveCount(entries: readonly Entry[]): number {
  return entries.filter(
    (entry) =>
      entry.category.key !== "searches" && entry.category.key !== "other",
  ).length;
}

/* ---------------------------------- table --------------------------------- */

/**
 * The table's columns. TYPE (the field type) is first; the full
 * untranslated Chrome name and every other wire field stay in the row
 * sheet. State only shows in the Recovered tab. Below `sm` a row stacks:
 * type and state, the value, then category, fills and last use.
 */
function entryColumns(
  reveal: boolean,
  recovered: boolean,
): readonly RowColumn<Entry>[] {
  const columns: RowColumn<Entry>[] = [
    {
      key: "type",
      header: "Type",
      className: "max-w-[220px]",
      stack: "lead",
      cell: (entry) =>
        entry.type === null ? (
          <FieldCell field={entry.row.fields.fieldName} />
        ) : (
          <span className="block truncate" title={entry.type}>
            {entry.type}
          </span>
        ),
    },
    {
      key: "value",
      header: "Value",
      className: "max-w-[340px] text-foreground",
      stack: "title",
      cell: (entry) =>
        !reveal && holdsSecret(entry) ? (
          <HiddenValue />
        ) : (
          <FieldCell field={entry.row.fields.fieldValue} />
        ),
    },
    {
      key: "category",
      header: "Category",
      className: "whitespace-nowrap",
      cell: (entry) => entry.category.label,
    },
    {
      key: "fills",
      header: "Fills",
      className: "tabular-nums",
      labelled: true,
      cell: (entry) => (
        <FieldCell
          field={entry.row.fields.timesUsed}
          format={(value) => Number(value).toLocaleString("en-US")}
        />
      ),
    },
    {
      key: "lastUsed",
      header: "Last used",
      className: "whitespace-nowrap",
      cell: (entry) => <TimeCell field={entry.row.fields.dateLastUsed} />,
    },
  ];
  if (recovered) {
    columns.push({
      key: "state",
      header: "State",
      stack: "aside",
      cell: (entry) => <StateWord state={entry.row.commitState} />,
    });
  }
  return columns;
}

/** One list (saved or recovered) with its loading, error, empty and footer. */
function EntryList({
  list,
  entries,
  visible,
  noun,
  reveal,
  onSelect,
  onClearFilters,
}: {
  readonly list: PaginatedList<Finding>;
  readonly entries: readonly Entry[];
  readonly visible: readonly Entry[];
  readonly noun: "saved" | "recovered";
  readonly reveal: boolean;
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
}) {
  const columns = useMemo(
    () => entryColumns(reveal, noun === "recovered"),
    [reveal, noun],
  );
  return (
    <ListBlock
      list={list}
      noun={{ one: `${noun} form entry`, many: `${noun} form entries` }}
      shown={visible.length}
      filtered={visible.length !== entries.length}
      onClearFilters={onClearFilters}
      skeletonRows={3}
      empty={
        <EmptyRows
          message={
            noun === "saved"
              ? "No saved Form data rows in this Case."
              : "No form entries were recovered from WAL or journal sidecars."
          }
        />
      }
    >
      <ResponsiveRows
        rows={visible}
        columns={columns}
        rowKey={(entry, index) => `${entry.row.commitState}-${String(index)}`}
        rowLabel={(entry) =>
          `Open ${entry.category.label} form entry ${entry.type ?? "of a type not recorded"}`
        }
        onSelect={(entry) => {
          onSelect(entry.row);
        }}
        tableClassName={noun === "saved" ? "min-w-[800px]" : "min-w-[900px]"}
      />
    </ListBlock>
  );
}

/**
 * The category chips: "All N", then each class with entries in the open tab
 * and its count there. One pick narrows the list; "All" clears.
 * Neutral — the class name is the label, no hue stands in.
 */
function CategoryChips({
  categories,
  entries,
  active,
  onPick,
}: {
  readonly categories: readonly FormDataCategory[];
  readonly entries: readonly Entry[];
  readonly active: string | null;
  readonly onPick: (key: string | null) => void;
}) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      map.set(entry.category.key, (map.get(entry.category.key) ?? 0) + 1);
    }
    return map;
  }, [entries]);
  // A class with no entry in the open tab sits out, unless it is the pick.
  const shown = categories.filter(
    (category) =>
      (counts.get(category.key) ?? 0) > 0 || category.key === active,
  );
  const selected =
    active === null
      ? 0
      : shown.findIndex((category) => category.key === active) + 1;
  return (
    // A phone scrolls the chips sideways rather than clipping them.
    <div className="scroll-fade-x max-w-full overflow-x-auto max-sm:w-full">
      <TabsSubtle
        idPrefix="autofill-category"
        aria-label="Narrow by category"
        selectedIndex={Math.max(0, selected)}
        onSelect={(index) => {
          onPick(index === 0 ? null : (shown[index - 1]?.key ?? null));
        }}
      >
        <TabsSubtleItem index={0} label={`All ${String(entries.length)}`} />
        {shown.map((category, index) => (
          <TabsSubtleItem
            key={category.key}
            index={index + 1}
            label={`${category.label} ${String(counts.get(category.key) ?? 0)}`}
          />
        ))}
      </TabsSubtle>
    </div>
  );
}

/** Placeholder at the size of the figure strip. */
function AutofillSkeleton() {
  return (
    <div role="status" aria-label="Loading form data figures">
      <Skeleton className="h-[76px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function AutofillPage({ config }: { readonly config: ArtifactConfig }) {
  const lists = useCommitStateLists<Finding>(
    config.route,
    AUTOFILL_PARAMETERS,
    {
      drain: AUTOFILL_ROW_CAP,
    },
  );
  const savedDone = lists.drained.saved;
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [view, setView] = useState<CommitView>("saved");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  const saved = useMemo(
    () => lists.saved.rows.map(toEntry),
    [lists.saved.rows],
  );
  const recovered = useMemo(
    () => lists.recovered.rows.map(toEntry),
    [lists.recovered.rows],
  );
  const sensitive = useMemo(() => sensitiveCount(saved), [saved]);
  const anyPayment = useMemo(
    () => [...saved, ...recovered].some(holdsSecret),
    [saved, recovered],
  );
  const listedCategories = useMemo(() => {
    const keys = new Set(
      [...saved, ...recovered].map((entry) => entry.category.key),
    );
    return FORM_DATA_CATEGORIES.filter((category) => keys.has(category.key));
  }, [saved, recovered]);

  const narrow = useCallback(
    (entries: readonly Entry[]) => {
      const query = search.trim().toLocaleLowerCase("en-US");
      return entries.filter((entry) => {
        if (categoryFilter !== null && entry.category.key !== categoryFilter) {
          return false;
        }
        if (query === "") {
          return true;
        }
        // A hidden Payment value is left out of the search text, so a match
        // can never disclose what it holds.
        const value = !reveal && holdsSecret(entry) ? "" : (entry.value ?? "");
        const haystack = [value, entry.type ?? ""]
          .join("\n")
          .toLocaleLowerCase("en-US");
        return haystack.includes(query);
      });
    },
    [search, categoryFilter, reveal],
  );
  const savedVisible = useMemo(() => narrow(saved), [narrow, saved]);
  const recoveredVisible = useMemo(
    () => narrow(recovered),
    [narrow, recovered],
  );

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setCategoryFilter(null);
  }, []);

  const savedFirst = lists.saved.loading && saved.length === 0;
  const recoveredFirst = lists.recovered.loading && recovered.length === 0;
  const pageEmpty =
    !savedFirst &&
    !recoveredFirst &&
    savedDone &&
    lists.saved.error === null &&
    lists.recovered.error === null &&
    saved.length === 0 &&
    recovered.length === 0;
  const figuresReady = savedDone || lists.saved.error !== null;
  const showFigures =
    !figuresReady || (lists.saved.error === null && saved.length > 0);
  const capped = lists.saved.cursor !== null && savedDone;

  const sensitiveShare =
    saved.length === 0 ? 0 : Math.round((sensitive / saved.length) * 100);

  const selectedIsPayment =
    selected !== null &&
    isPaymentField(fieldText(selected.row.fields.fieldName));

  return (
    <div className="flex flex-col gap-5">
      {pageEmpty ? (
        <Panel>
          <EmptyRows
            icon={ARTIFACT_ICONS.autofill}
            title="No form data"
            message="No Form data rows in this Case, saved or recovered."
          />
        </Panel>
      ) : (
        <>
          {showFigures ? (
            <RevealSwap loading={!figuresReady} skeleton={<AutofillSkeleton />}>
              <MetricBand className="grid-cols-2">
                <MetricBandItem
                  label="Saved entries"
                  value={`${saved.length.toLocaleString("en-US")}${capped ? "+" : ""}`}
                />
                <MetricBandItem
                  label={
                    <Term label="Sensitive">
                      Identity, contact, address or payment entries.
                    </Term>
                  }
                  value={
                    <Tooltip
                      content={`${sensitive.toLocaleString("en-US")} of ${saved.length.toLocaleString("en-US")} saved entries`}
                    >
                      <span className="cursor-default">{`${String(sensitiveShare)}%`}</span>
                    </Tooltip>
                  }
                />
              </MetricBand>
            </RevealSwap>
          ) : null}

          <SectionPanel id="autofill-list" title="All form entries">
            <CommitStateSplit
              value={view}
              onValueChange={setView}
              label="Saved or recovered form entries"
              savedCount={
                savedFirst || (lists.saved.error !== null && saved.length === 0)
                  ? null
                  : saved.length
              }
              recoveredCount={
                recoveredFirst ||
                (lists.recovered.error !== null && recovered.length === 0)
                  ? null
                  : recovered.length
              }
              savedMore={lists.saved.cursor !== null}
              recoveredMore={lists.recovered.cursor !== null}
              toolbar={
                <>
                  {listedCategories.length > 1 ? (
                    <CategoryChips
                      categories={listedCategories}
                      entries={view === "saved" ? saved : recovered}
                      active={categoryFilter}
                      onPick={setCategoryFilter}
                    />
                  ) : null}
                  {anyPayment ? (
                    <Switch
                      label="Show values"
                      checked={reveal}
                      onToggle={() => {
                        setReveal((value) => !value);
                      }}
                      className="sm:mx-2"
                    />
                  ) : null}
                  <FilterTextField
                    commit="change"
                    label="Search loaded form entries"
                    placeholder="Search value or type"
                    icon={SearchIcon}
                    value={search}
                    onCommit={setSearch}
                  />
                </>
              }
              saved={
                <EntryList
                  list={lists.saved}
                  entries={saved}
                  visible={savedVisible}
                  noun="saved"
                  reveal={reveal}
                  onSelect={select}
                  onClearFilters={clearFilters}
                />
              }
              recovered={
                <EntryList
                  list={lists.recovered}
                  entries={recovered}
                  visible={recoveredVisible}
                  noun="recovered"
                  reveal={reveal}
                  onSelect={select}
                  onClearFilters={clearFilters}
                />
              }
            />
          </SectionPanel>
        </>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={
            readableFieldType(fieldText(selected.row.fields.fieldName)) ??
            "Form entry"
          }
          redactedFields={selectedIsPayment ? PAYMENT_SECRET_FIELDS : undefined}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
