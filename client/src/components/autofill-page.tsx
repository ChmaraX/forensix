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
 * secrets, and so is any value whose field name was not recorded (it
 * cannot be ruled out as Payment: `isSecretFormField` fails closed): they
 * read "value hidden" in the table until the page's "Show values" switch
 * is on, are left out of the search text while hidden, and stay hidden in
 * the row sheet behind its own Reveal (`RowSheet`).
 *
 * TYPE (the field type) is the first table column. Saved entries and entries
 * recovered from WAL / journal sidecars are separate server reads and
 * separate lists (the Saved / Recovered tabs), keyset-paged. The figures
 * and the tab counts are the server's counts (`count-reads.ts`) of every
 * saved entry in the profiles the Case-wide lens picks (a server filter
 * too), never a reading of the rows loaded so far; the category chips count
 * the loaded rows ("36+" while more pages stand). No control here can
 * start or rerun ingest, analysis, or export.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { rowRefOf } from "../router.js";
import {
  useRowSelection,
  useViewFilter,
  useViewSearch,
  useViewTab,
} from "../view-state.js";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { ARTIFACT_ICONS, SearchIcon } from "@/lib/app-icons";
import { SizeProvider } from "@/lib/size-context";

import type { QueryParameters } from "../api.js";
import type { CountResult, Finding } from "../types.js";
import { ARTIFACTS } from "../artifacts.js";
import {
  formatTally,
  recordsWhere,
  useCommitStateTotals,
  useCount,
  type Tally,
} from "../count-reads.js";
import type { RowLookupSource } from "../row-lookup.js";
import {
  commitStateStatus,
  type PaginatedList,
  useCommitStateLists,
} from "../use-commit-state-lists.js";
import { CommitStatePage } from "./commit-state-page.js";
import { EmptyRows } from "./data-table.js";
import {
  CommitStateSplit,
  CountChips,
  SectionPanel,
  TimeCell,
  type CountChip,
} from "./page-kit.js";
import { FieldCell, StateWord } from "./finding-fields.js";
import {
  CompactFilters,
  FilterField,
  FilterTextField,
  matchesSearch,
  ProfilePicker,
} from "./filters.js";
import {
  categoryOf,
  FORM_DATA_CATEGORIES,
  formFieldLabel,
  isSecretFormField,
  type FormDataCategory,
} from "./form-data.js";
import {
  ArtifactEmpty,
  clearSearchAndProfiles,
  EmptyPivot,
  useProfileLens,
} from "./identity-kit.js";
import { useArtifactCoverage } from "../case-context.js";
import { ListBlock } from "./list-states.js";
import { SM_UP, useMediaQuery } from "./use-media-query.js";
import {
  figure,
  MetricBand,
  MetricBandItem,
  TooltipFigure,
} from "./metric-band.js";
import { HiddenValue, RowSheet } from "./row-sheet.js";
import { Term } from "./term.js";
import { fieldText } from "../field-readers.js";
import { ResponsiveRows, type RowColumn } from "./responsive-rows.js";
import { emptyCoverageOf } from "./identity-coverage.js";

/* ------------------------------ data reading ------------------------------ */

const AUTOFILL_PARAMETERS: QueryParameters = [
  ["sort", "last-used-time"],
  ["direction", "desc"],
  ["limit", "100"],
];

/** The Finding kind of a form entry (the `count` route's `kind`). */
const AUTOFILL_KIND = "autofill_entry";

/** True for an entry whose recorded, non-empty value is a secret - a
 *  Payment field, or a field whose name was not recorded (fails closed) -
 *  the value the page withholds until "Show values" is on. */
function holdsSecret(entry: Entry): boolean {
  return entry.secret && entry.value !== null;
}

/* ------------------------------ derived reads ----------------------------- */

interface Entry {
  readonly row: Finding;
  /** The recorded non-empty value, or null (see `row.fields.fieldValue`). */
  readonly value: string | null;
  readonly type: string | null;
  readonly category: FormDataCategory;
  /** The value is a secret (`isSecretFormField`). */
  readonly secret: boolean;
}

function toEntry(row: Finding): Entry {
  const type = fieldText(row.fields.fieldName);
  return {
    row,
    value: fieldText(row.fields.fieldValue),
    type: formFieldLabel(type),
    category: categoryOf(type),
    secret: isSecretFormField(row.fields.fieldName),
  };
}

/** Identity + Contact + Address + Payment: the entries that carry directly
 *  identifying or financial data, as opposed to search text. */
function isSensitive(category: FormDataCategory): boolean {
  return category.key !== "searches" && category.key !== "other";
}

/** The sensitive saved entries in a `by=fieldName` count: each bucket's
 *  field name sorted into its category by the same rule as the rows. A
 *  floor when the server listed only its largest buckets. */
export function sensitiveTally(result: CountResult): Tally {
  return recordsWhere(
    result,
    (bucket) => bucket.state === "value" && isSensitive(categoryOf(bucket.key)),
  );
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
      className: "text-right tabular-nums",
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
      header: "Last used (UTC)",
      label: "Last used",
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

/** A row's key: its reference, so a filter never hands one row's memoised
 *  cells to another. */
function entryKey(entry: Entry): string {
  return rowRefOf(entry.row);
}

function entryLabel(entry: Entry): string {
  return `Open ${entry.category.label} form entry ${entry.type ?? "of a type not recorded"}`;
}

/** One list (saved or recovered) with its loading, error, empty and footer. */
function EntryList({
  list,
  entries,
  visible,
  lensFiltered,
  noun,
  reveal,
  onSelect,
  onClearFilters,
  filteredMessage,
  chips,
}: {
  readonly list: PaginatedList<Finding>;
  readonly entries: readonly Entry[];
  readonly visible: readonly Entry[];
  /** The profile pick (a server filter) narrows the list. */
  readonly lensFiltered: boolean;
  readonly noun: "saved" | "recovered";
  readonly reveal: boolean;
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
  readonly filteredMessage?: string;
  /** The category chips for this tab, on their own line above the list. */
  readonly chips?: ReactNode;
}) {
  const columns = useMemo(
    () => entryColumns(reveal, noun === "recovered"),
    [reveal, noun],
  );
  const select = useCallback(
    (entry: Entry) => {
      onSelect(entry.row);
    },
    [onSelect],
  );
  const block = (
    <ListBlock
      list={list}
      noun={{ one: `${noun} form entry`, many: `${noun} form entries` }}
      shown={visible.length}
      filtered={lensFiltered || visible.length !== entries.length}
      filteredMessage={filteredMessage}
      onClearFilters={onClearFilters}
      skeletonRows={3}
      empty={
        <EmptyRows
          message={
            noun === "saved"
              ? "No saved form entries in this Case."
              : "No form entries were recovered from Chrome's temporary database files."
          }
        />
      }
    >
      <ResponsiveRows
        rows={visible}
        columns={columns}
        rowKey={entryKey}
        rowLabel={entryLabel}
        onSelect={select}
        tableClassName={noun === "saved" ? "min-w-[800px]" : "min-w-[900px]"}
      />
    </ListBlock>
  );
  if (chips === undefined || chips === null || entries.length === 0) {
    return block;
  }
  // The categories narrow what is in this tab, so they sit with its rows:
  // their own line under the toolbar's hairline, where six chips never
  // push the search and switches onto a broken second line.
  return (
    <>
      <SizeProvider size="compact">
        <div className="px-3.5 pt-2.5 pb-1">{chips}</div>
      </SizeProvider>
      {block}
    </>
  );
}

/**
 * The category chips (page-kit `CountChips`): "All N", then each class with
 * entries in the open tab and its count there. One pick narrows the list;
 * "All" clears. Neutral — the class name is the label, no hue stands in.
 */
function CategoryChips({
  categories,
  entries,
  active,
  onPick,
  partial,
}: {
  readonly categories: readonly FormDataCategory[];
  readonly entries: readonly Entry[];
  readonly active: string | null;
  readonly onPick: (key: string | null) => void;
  /** The list stopped at its cap: counts of loaded entries ("36+"). */
  readonly partial: boolean;
}) {
  const chips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      counts.set(entry.category.key, (counts.get(entry.category.key) ?? 0) + 1);
    }
    // A class with no entry in the open tab sits out, unless it is the pick.
    return categories
      .filter(
        (category) =>
          (counts.get(category.key) ?? 0) > 0 || category.key === active,
      )
      .map((category): CountChip => ({
        key: category.key,
        label: category.label,
        count: counts.get(category.key) ?? 0,
      }));
  }, [categories, entries, active]);
  return (
    <CountChips
      label="Narrow by category"
      total={entries.length}
      chips={chips}
      active={active}
      onChange={onPick}
      partial={partial}
    />
  );
}

/** The chips' "All" as a Select value (no category key starts with NUL). */
const ALL_CATEGORIES = "\u0000all";

/**
 * The same pick as `CategoryChips`, for a phone: one Select ("All 12",
 * "Payment 1", …) in the toolbar, where six chips would scroll out of
 * sight behind the edge fade.
 */
function CategorySelect({
  categories,
  entries,
  active,
  onPick,
  partial,
}: {
  readonly categories: readonly FormDataCategory[];
  readonly entries: readonly Entry[];
  readonly active: string | null;
  readonly onPick: (key: string | null) => void;
  /** The list stopped at its cap: counts of loaded entries ("36+"). */
  readonly partial: boolean;
}) {
  const options = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      counts.set(entry.category.key, (counts.get(entry.category.key) ?? 0) + 1);
    }
    return [
      { key: ALL_CATEGORIES, label: "All", count: entries.length },
      ...categories
        .filter(
          (category) =>
            (counts.get(category.key) ?? 0) > 0 || category.key === active,
        )
        .map((category) => ({
          key: category.key,
          label: category.label,
          count: counts.get(category.key) ?? 0,
        })),
    ];
  }, [categories, entries, active]);
  return (
    <FilterField label="Category" htmlFor="autofill-category">
      <Select
        value={active ?? ALL_CATEGORIES}
        onValueChange={(key) => {
          onPick(key === ALL_CATEGORIES ? null : key);
        }}
      >
        <SelectTrigger id="autofill-category" />
        <SelectContent>
          {options.map((option, index) => (
            <SelectItem key={option.key} index={index} value={option.key}>
              {option.label}{" "}
              <span className="text-muted-foreground tabular-nums">
                {option.count.toLocaleString("en-US")}
                {partial ? "+" : ""}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterField>
  );
}

/** Placeholder at the size of the figure strip. */
function AutofillSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading form data figures</span>
      <Skeleton className="h-[76px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

const config = ARTIFACTS.autofill;
/** A URL-named row this page has not loaded is read by its reference. */
const ROW_LOOKUP: RowLookupSource = { route: config.route };

export function AutofillPage() {
  // The profile pick is the Case-wide lens, applied by the server.
  const lens = useProfileLens();
  const parameters = useMemo<QueryParameters>(
    () => [...AUTOFILL_PARAMETERS, ...lens.parameters],
    [lens.parameters],
  );
  const lists = useCommitStateLists<Finding>(config.route, parameters);
  const totals = useCommitStateTotals(AUTOFILL_KIND, lens.selected);
  const fieldNames = useCount({
    kind: AUTOFILL_KIND,
    by: "fieldName",
    commitState: "committed",
    profiles: lens.selected,
  });
  // Saved / Recovered, the search and the open row live in the URL: Back
  // and a refresh keep them.
  const [view, setView] = useViewTab();
  const [search, setSearch] = useViewSearch();
  // The category pick is in the URL (`filter`), so refresh and Back keep
  // it.
  const [categoryFilter, setCategoryFilter] = useViewFilter();
  // Values open hidden on every visit (never in the URL).
  const [reveal, setReveal] = useState(false);
  const coverage = useArtifactCoverage(config.completenessArtifact);

  const saved = useMemo(
    () => lists.saved.rows.map(toEntry),
    [lists.saved.rows],
  );
  const recovered = useMemo(
    () => lists.recovered.rows.map(toEntry),
    [lists.recovered.rows],
  );
  const loaded = useMemo(
    () => [...lists.saved.rows, ...lists.recovered.rows],
    [lists.saved.rows, lists.recovered.rows],
  );
  const sheet = useRowSelection(loaded, ROW_LOOKUP);
  // The lists hold the lens's profiles only (a server filter); the category
  // and the search narrow only the loaded lists.
  const anyHidden = useMemo(
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
    (entries: readonly Entry[]) =>
      entries.filter(
        (entry) =>
          (categoryFilter === null || entry.category.key === categoryFilter) &&
          // A hidden value is left out of the search text, so a match can
          // never disclose what it holds.
          matchesSearch(search, [
            !reveal && holdsSecret(entry) ? null : entry.value,
            entry.type,
          ]),
      ),
    [search, categoryFilter, reveal],
  );
  const savedVisible = useMemo(() => narrow(saved), [narrow, saved]);
  const recoveredVisible = useMemo(
    () => narrow(recovered),
    [narrow, recovered],
  );

  const status = commitStateStatus(
    lists,
    { saved: saved.length, recovered: recovered.length },
    totals,
    lens.selected.length > 0,
  );
  const filteredMessage = (noun: string) =>
    search.trim() === "" && categoryFilter === null && lens.words !== null
      ? `No ${noun} in ${lens.words}.`
      : undefined;

  const wide = useMediaQuery(SM_UP);
  const chipsFor = (entries: readonly Entry[], partial: boolean) =>
    wide && listedCategories.length > 1 ? (
      <CategoryChips
        categories={listedCategories}
        entries={entries}
        active={categoryFilter}
        onPick={setCategoryFilter}
        partial={partial}
      />
    ) : null;

  return (
    <CommitStatePage
      status={status}
      empty={
        <ArtifactEmpty
          icon={ARTIFACT_ICONS.autofill}
          coverage={emptyCoverageOf(coverage)}
          artifact="Web Data"
          title="No form data"
          what="form entries"
          pivot={<EmptyPivot page="history">Open History</EmptyPivot>}
        />
      }
      figuresSkeleton={<AutofillSkeleton />}
      figures={
        <MetricBand className="grid-cols-2">
          <MetricBandItem
            label="Saved entries"
            value={figure(totals, (value) =>
              value.saved.toLocaleString("en-US"),
            )}
          />
          <MetricBandItem
            label={
              <Term label="Sensitive">
                Identity, contact, address or payment entries.
              </Term>
            }
            value={figure(fieldNames, (value) => {
              const sensitive = sensitiveTally(value);
              const share =
                value.total === 0
                  ? 0
                  : Math.round((sensitive.count / value.total) * 100);
              return (
                <TooltipFigure
                  value={`${String(share)}%${sensitive.more ? "+" : ""}`}
                  detail={`${formatTally(sensitive)} of ${value.total.toLocaleString("en-US")} saved entries`}
                />
              );
            })}
          />
        </MetricBand>
      }
      sheet={
        sheet.selected === null ? null : (
          <RowSheet
            selected={sheet.selected}
            title={
              formFieldLabel(fieldText(sheet.selected.row.fields.fieldName)) ??
              "Form entry"
            }
            onClose={sheet.close}
          />
        )
      }
    >
      <SectionPanel id="autofill-list" title="All form entries">
        <CommitStateSplit
          value={view}
          onValueChange={setView}
          label="Saved or recovered form entries"
          {...status.split}
          toolbar={
            <>
              {anyHidden ? (
                <Switch
                  label="Show values"
                  checked={reveal}
                  onToggle={() => {
                    setReveal((value) => !value);
                  }}
                  className="max-sm:-ml-2.5 sm:mx-2"
                />
              ) : null}
              <CompactFilters
                active={
                  (categoryFilter === null ? 0 : 1) +
                  (lens.selected.length > 0 ? 1 : 0)
                }
              >
                {!wide && listedCategories.length > 1 ? (
                  <CategorySelect
                    categories={listedCategories}
                    entries={view === "saved" ? saved : recovered}
                    active={categoryFilter}
                    onPick={setCategoryFilter}
                    partial={
                      (view === "saved" ? lists.saved : lists.recovered)
                        .cursor !== null
                    }
                  />
                ) : null}
                {lens.showPicker ? (
                  <FilterField label="Profiles" htmlFor="autofill-profiles">
                    <ProfilePicker
                      id="autofill-profiles"
                      profiles={lens.options}
                      selected={lens.selected}
                      onChange={lens.setSelected}
                    />
                  </FilterField>
                ) : null}
              </CompactFilters>
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
              lensFiltered={lens.selected.length > 0}
              noun="saved"
              reveal={reveal}
              onSelect={sheet.select}
              onClearFilters={clearSearchAndProfiles}
              filteredMessage={filteredMessage("saved form entries")}
              chips={chipsFor(saved, lists.saved.cursor !== null)}
            />
          }
          recovered={
            <EntryList
              list={lists.recovered}
              entries={recovered}
              visible={recoveredVisible}
              lensFiltered={lens.selected.length > 0}
              noun="recovered"
              reveal={reveal}
              onSelect={sheet.select}
              onClearFilters={clearSearchAndProfiles}
              filteredMessage={filteredMessage("recovered form entries")}
              chips={chipsFor(recovered, lists.recovered.cursor !== null)}
            />
          }
        />
      </SectionPanel>
    </CommitStatePage>
  );
}
