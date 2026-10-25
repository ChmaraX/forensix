/**
 * The Candidates page: the identity and behavior hypotheses the analyzer
 * ranked from the recorded rows (`candidates` route) - a name, an e-mail
 * address, a frequently visited host, a repeated search.
 *
 * Candidates are never facts. Every surface here says so in words: the
 * page sits in the sidebar's Case group (conclusions about the evidence),
 * the list panel is titled "Ranked candidates" beside a "Candidate" badge
 * that explains the term, every group is headed "<kind> candidates", and
 * the sheet's header carries the same badge where a Finding's sheet carries
 * its Commit State. Identity and behavior Candidates have no Commit State
 * (the analyzer derives them from saved and recovered rows alike), so no
 * Saved / Recovered split, State column or Commit State badge appears; no
 * Candidate value ever becomes a figure or a tile.
 *
 * Each row shows its rank (1 is the strongest within its kind and
 * profile), the candidate value as a Field State (value, (empty), absent or
 * unavailable, in words), its supporting row count and the evidence basis
 * the analyzer recorded; its sheet adds the source chain of the primary
 * row and of every supporting row. The list is the server's order (rank,
 * keyset-paged with Load more), grouped by kind on the client; the profile
 * pick (the Case-wide lens) and the category pick are server filters.
 */
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ARTIFACT_ICONS } from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import { fieldLabel } from "../field-labels.js";
import { returnTarget } from "../focus.js";
import type { RowLookupSource } from "../row-lookup.js";
import { rowRefOf } from "../router.js";
import type { IdentityCandidate, Provenance } from "../types.js";
import { usePaginatedList } from "../use-paginated-list.js";
import { useRowSelection, useViewFilter } from "../view-state.js";
import { EmptyRows } from "./data-table.js";
import { FieldStateText } from "./field-state.js";
import { FieldCell, fieldText, profileLabel } from "./finding-fields.js";
import { CompactFilters, FilterField, ProfilePicker } from "./filters.js";
import { clearSearchAndProfiles, useProfileLens } from "./identity-kit.js";
import { ListBlock } from "./list-states.js";
import {
  Count,
  ResponsiveRows,
  SectionPanel,
  Toolbar,
  type RowColumn,
} from "./page-kit.js";
import { PROPERTY_ROW, ProvenanceLine, SectionTitle } from "./row-sheet.js";
import { Term, TermExplanation, TermTooltip } from "./term.js";

/* --------------------------------- kinds ---------------------------------- */

/** Each Candidate kind in words (singular, plural), in the order the page
 *  lists them: identity first, then behavior. */
const KINDS: readonly {
  readonly kind: string;
  readonly one: string;
  readonly many: string;
}[] = [
  { kind: "identity_name", one: "Name", many: "Names" },
  { kind: "identity_email", one: "E-mail address", many: "E-mail addresses" },
  { kind: "identity_phone", one: "Phone number", many: "Phone numbers" },
  {
    kind: "identity_postal_address",
    one: "Postal address",
    many: "Postal addresses",
  },
  { kind: "identity_country", one: "Country", many: "Countries" },
  {
    kind: "behavior_frequent_host",
    one: "Frequently visited host",
    many: "Frequently visited hosts",
  },
  {
    kind: "behavior_search_query",
    one: "Repeated search",
    many: "Repeated searches",
  },
];

/** A Candidate kind's words; an unknown kind reads as recorded. */
export function candidateKindWords(kind: string): {
  readonly one: string;
  readonly many: string;
} {
  const known = KINDS.find((entry) => entry.kind === kind);
  return known ?? { one: kind, many: kind };
}

/** Rows grouped by kind, in `KINDS` order (unknown kinds after, in the
 *  order they arrive); each group keeps the server's (rank) order. */
export function groupByKind<Row extends { readonly candidateKind: string }>(
  rows: readonly Row[],
): readonly { readonly kind: string; readonly rows: readonly Row[] }[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const group = groups.get(row.candidateKind) ?? [];
    group.push(row);
    groups.set(row.candidateKind, group);
  }
  const order = (kind: string) => {
    const index = KINDS.findIndex((entry) => entry.kind === kind);
    return index === -1 ? KINDS.length : index;
  };
  return [...groups.entries()]
    .map(([kind, group]) => ({ kind, rows: group }))
    .sort((left, right) => order(left.kind) - order(right.kind));
}

/* --------------------------------- labels --------------------------------- */

const CANDIDATE_MEANING =
  "A ranked guess the analyzer drew from recorded rows - not a recorded fact. It has no saved or recovered state: it is derived from rows of either kind.";

/** The persistent "Candidate" label, with what the word means. */
function CandidateBadge() {
  return (
    <TermTooltip
      content={
        <TermExplanation technical="Identity or behavior Candidate (ranked)">
          {CANDIDATE_MEANING}
        </TermExplanation>
      }
    >
      <Badge size="compact" tabIndex={0} className="cursor-help">
        Candidate
      </Badge>
    </TermTooltip>
  );
}

/* --------------------------------- table ---------------------------------- */

const SUPPORTING_HEADER = (
  <Term label="Supporting rows">
    How many recorded rows back this candidate. More rows rank it higher; it is
    still a guess.
  </Term>
);

function candidateColumns(
  withProfile: boolean,
): readonly RowColumn<IdentityCandidate>[] {
  const columns: RowColumn<IdentityCandidate>[] = [
    {
      key: "rank",
      header: "Rank",
      className: "w-20 whitespace-nowrap tabular-nums",
      stack: "lead",
      cell: (row) => `#${String(row.rank)}`,
    },
    {
      key: "value",
      header: "Candidate value",
      className: "truncate text-foreground",
      stack: "title",
      cell: (row) => <FieldCell field={row.fields.candidateValue} />,
    },
    {
      key: "supporting",
      header: SUPPORTING_HEADER,
      label: "Supporting rows",
      className: "w-40 text-right tabular-nums",
      labelled: true,
      cell: (row) => row.supportingCount.toLocaleString("en-US"),
    },
    {
      key: "basis",
      header: "Evidence basis",
      className: "w-48 truncate",
      labelled: true,
      cell: (row) => <FieldCell field={row.fields.evidenceBasis} />,
    },
  ];
  if (withProfile) {
    columns.push({
      key: "profile",
      header: "Profile",
      className: "w-40 truncate whitespace-nowrap",
      labelled: true,
      cell: (row) => profileLabel(row.profile),
    });
  }
  return columns;
}

function candidateKey(row: IdentityCandidate, index: number): string {
  return rowRefOf(row) ?? `${row.candidateKind}-${String(index)}`;
}

function candidateLabel(row: IdentityCandidate): string {
  return `Open ${candidateKindWords(row.candidateKind).one.toLowerCase()} candidate ${fieldText(row.fields.candidateValue) ?? "with no recorded value"}, rank ${String(row.rank)}`;
}

/** One kind's candidates under its own heading. */
function KindGroup({
  kind,
  rows,
  more,
  columns,
  onSelect,
}: {
  readonly kind: string;
  readonly rows: readonly IdentityCandidate[];
  /** More pages stand: the count is of the loaded rows ("3+"). */
  readonly more: boolean;
  readonly columns: readonly RowColumn<IdentityCandidate>[];
  readonly onSelect: (row: IdentityCandidate) => void;
}) {
  const size = useSize();
  const words = candidateKindWords(kind);
  const id = `candidates-${kind}`;
  return (
    <section aria-labelledby={id} className="border-t border-border pt-2">
      <div className="flex items-baseline gap-2 px-4 pt-1 pb-1">
        <h3
          id={id}
          className={cn(size.type.body, "text-foreground")}
          style={{ fontVariationSettings: fontWeights.semibold }}
          title={kind}
        >
          {words.one} candidates
        </h3>
        <Count>
          {rows.length.toLocaleString("en-US")}
          {more ? "+" : ""}
        </Count>
      </div>
      <ResponsiveRows
        rows={rows}
        columns={columns}
        rowKey={candidateKey}
        rowLabel={candidateLabel}
        onSelect={onSelect}
        // Fixed columns line every kind's table up with the next one.
        tableClassName="min-w-[720px] table-fixed"
      />
    </section>
  );
}

/* ---------------------------------- sheet --------------------------------- */

/** The source chain of one row (file, table, row id). */
function SourceChain({ provenance }: { readonly provenance: Provenance }) {
  return (
    <dl className="flex flex-col divide-y divide-border">
      {provenance.sourceId === undefined ? null : (
        <ProvenanceLine label="Source" value={provenance.sourceId} />
      )}
      <ProvenanceLine label="File" value={provenance.manifestPath} />
      <ProvenanceLine label="Table" value={provenance.table} />
      <ProvenanceLine label="Row id" value={provenance.rowId} />
    </dl>
  );
}

/** Supporting rows the sheet lists by their source chain line. */
const SUPPORTING_SHOWN = 20;

/**
 * A Candidate's detail: its value as a hypothesis (the "Candidate" badge
 * where a Finding shows its Commit State), its rank and support, the
 * source chain of its primary row and of the supporting rows the analyzer
 * recorded, then every field with its Field State in words.
 */
function CandidateSheet({
  row,
  onClose,
}: {
  readonly row: IdentityCandidate;
  readonly onClose: () => void;
}) {
  const size = useSize();
  const words = candidateKindWords(row.candidateKind);
  const supporting = row.provenance.supportingRows ?? [];
  const fields = Object.entries(row.fields);
  const [returnFocus] = useState<HTMLElement | null>(() =>
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body
      ? document.activeElement
      : null,
  );
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const active = document.activeElement;
          if (active !== null && active !== document.body) {
            return;
          }
          returnTarget(
            returnFocus,
            document.querySelector<HTMLElement>("[data-page-column]"),
          )?.focus({ preventScroll: true });
        }}
      >
        <SheetHeader className="gap-2 border-b border-border pb-4">
          <SheetTitle className="break-words">
            {fieldText(row.fields.candidateValue) ?? `${words.one} candidate`}
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CandidateBadge />
            <SheetDescription className="min-w-0">
              <span title={row.candidateKind}>{words.one}</span>
              {" · rank "}
              <span className="tabular-nums">{row.rank}</span>
              {" · "}
              <span className="text-foreground">
                {profileLabel(row.profile)}
              </span>
            </SheetDescription>
          </div>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-6 pt-4">
          <section aria-label="Ranking">
            <SectionTitle>Ranking</SectionTitle>
            <dl className="flex flex-col divide-y divide-border">
              <div className={cn(PROPERTY_ROW, "py-2")}>
                <dt className={cn(size.type.body, "text-muted-foreground")}>
                  Rank
                </dt>
                <dd className={cn(size.type.body, "tabular-nums")}>
                  {row.rank} among {words.many.toLowerCase()} in{" "}
                  {profileLabel(row.profile)}
                </dd>
              </div>
              <div className={cn(PROPERTY_ROW, "py-2")}>
                <dt className={cn(size.type.body, "text-muted-foreground")}>
                  Supporting rows
                </dt>
                <dd className={cn(size.type.body, "tabular-nums")}>
                  {row.supportingCount.toLocaleString("en-US")}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-label="Source">
            <SectionTitle>Where this comes from</SectionTitle>
            <SourceChain provenance={row.provenance} />
          </section>

          {supporting.length === 0 ? null : (
            <section aria-label="Supporting rows">
              <div className="flex items-baseline gap-2">
                <SectionTitle>Supporting rows</SectionTitle>
                <Count>
                  {supporting.length > SUPPORTING_SHOWN
                    ? `first ${String(SUPPORTING_SHOWN)} of ${supporting.length.toLocaleString("en-US")} recorded`
                    : supporting.length.toLocaleString("en-US")}
                </Count>
              </div>
              <ul className="flex flex-col divide-y divide-border">
                {supporting.slice(0, SUPPORTING_SHOWN).map((source, index) => (
                  <li
                    key={`${source.manifestPath ?? ""}|${source.table ?? ""}|${source.rowId ?? String(index)}`}
                    className={cn(
                      size.type.body,
                      "py-2 font-mono [overflow-wrap:anywhere] text-foreground",
                    )}
                  >
                    {[source.manifestPath, source.table, source.rowId]
                      .map((part) =>
                        part === undefined || part === "" ? "absent" : part,
                      )
                      .join(" · ")}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Fields">
            <div className="flex items-baseline gap-2">
              <SectionTitle>Fields</SectionTitle>
              <Count>{fields.length}</Count>
            </div>
            <dl className="flex flex-col divide-y divide-border">
              {fields.map(([name, field]) => (
                <div
                  key={name}
                  className={cn(PROPERTY_ROW, "items-start gap-y-0.5 py-2")}
                >
                  <dt className="flex min-w-0 flex-col">
                    <span
                      className={cn(
                        size.type.body,
                        "break-words text-muted-foreground",
                      )}
                    >
                      {fieldLabel(name, row.candidateKind)}
                    </span>
                    <span
                      className={cn(
                        size.type.caption,
                        "font-mono text-muted-foreground [overflow-wrap:anywhere]",
                      )}
                    >
                      {name}
                    </span>
                  </dt>
                  <dd className="min-w-0 text-foreground">
                    <FieldStateText field={field} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------------------------- page ---------------------------------- */

/** The category pick as a Select value ("All" has no category key). */
const ALL_CATEGORIES = "\u0000all";
const CATEGORIES = [
  { key: "identity", label: "Identity" },
  { key: "behavior", label: "Behavior" },
] as const;

/** Identity Candidates have no Commit State: a URL-named row is looked up
 *  by its profile only. */
const ROW_LOOKUP: RowLookupSource = {
  route: "candidates",
  byCommitState: false,
};

export function CandidatesPage() {
  const lens = useProfileLens();
  // The category pick is in the URL (`filter`): Back and a refresh keep it.
  const [filter, setFilter] = useViewFilter();
  const category =
    filter === "identity" || filter === "behavior" ? filter : null;
  const parameters = useMemo<QueryParameters>(
    () => [
      ["sort", "rank"],
      ["direction", "asc"],
      ["limit", "100"],
      ...(category === null ? [] : [["category", category] as const]),
      ...lens.parameters,
    ],
    [category, lens.parameters],
  );
  const list = usePaginatedList<IdentityCandidate>("candidates", parameters);
  const sheet = useRowSelection(list.rows, ROW_LOOKUP);
  const groups = useMemo(() => groupByKind(list.rows), [list.rows]);
  const withProfile = lens.options.length > 1 && lens.selected.length !== 1;
  const columns = useMemo(() => candidateColumns(withProfile), [withProfile]);
  const more = list.cursor !== null;
  const filtered = category !== null || lens.selected.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <SectionPanel
        id="candidates-list"
        title="Ranked candidates"
        description="Ranked guesses drawn from recorded rows - never recorded facts. Open one to see the rows behind it."
        aside={<CandidateBadge />}
      >
        <Toolbar>
          <CompactFilters
            active={
              (category === null ? 0 : 1) + (lens.selected.length > 0 ? 1 : 0)
            }
          >
            <FilterField label="Category" htmlFor="candidates-category">
              <Select
                value={category ?? ALL_CATEGORIES}
                onValueChange={(value) => {
                  setFilter(value === ALL_CATEGORIES ? null : value);
                }}
              >
                <SelectTrigger id="candidates-category" />
                <SelectContent>
                  <SelectItem index={0} value={ALL_CATEGORIES}>
                    All
                  </SelectItem>
                  {CATEGORIES.map((entry, index) => (
                    <SelectItem
                      key={entry.key}
                      index={index + 1}
                      value={entry.key}
                    >
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            {lens.showPicker ? (
              <FilterField label="Profiles" htmlFor="candidates-profiles">
                <ProfilePicker
                  id="candidates-profiles"
                  profiles={lens.options}
                  selected={lens.selected}
                  onChange={lens.setSelected}
                />
              </FilterField>
            ) : null}
          </CompactFilters>
        </Toolbar>
        <ListBlock
          list={list}
          noun={{ one: "candidate", many: "candidates" }}
          filtered={filtered}
          filteredMessage={`No candidates${category === null ? "" : ` of the ${category} category`}${lens.words === null ? "" : ` in ${lens.words}`}.`}
          onClearFilters={clearSearchAndProfiles}
          skeletonRows={6}
          empty={
            <EmptyRows
              icon={ARTIFACT_ICONS.candidates}
              title="No candidates"
              message="The analyzer ranked no identity or behavior candidates in this Case."
            />
          }
        >
          <div className="flex flex-col gap-2 pb-1">
            {groups.map((group) => (
              <KindGroup
                key={group.kind}
                kind={group.kind}
                rows={group.rows}
                more={more}
                columns={columns}
                onSelect={sheet.select}
              />
            ))}
          </div>
        </ListBlock>
      </SectionPanel>
      {sheet.selected === null ? null : (
        <CandidateSheet row={sheet.selected.row} onClose={sheet.close} />
      )}
    </div>
  );
}
