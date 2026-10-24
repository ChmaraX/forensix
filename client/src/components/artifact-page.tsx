/**
 * Generic artifact page: the Completeness Statement, the filter bar, then the
 * saved (committed) and recovered (sidecar) Finding lists as two separate
 * lists — sidecar rows never mix into the committed list. Used for any
 * artifact without a dedicated page. Moved out of app.tsx; data logic is
 * unchanged.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { QueryParameters } from "../api.js";
import { SIDECAR_STATES } from "../artifacts.js";
import { COMMIT_META } from "../terms.js";
import type {
  ArtifactConfig,
  CaseCompleteness,
  CommitState,
  Finding,
} from "../types.js";
import { usePaginatedList } from "../use-paginated-list.js";
import { CompletenessPanel } from "./completeness.js";
import { FindingsTable } from "./data-table.js";
import { EvidenceDot } from "./evidence.js";
import {
  FilterBar,
  filterParameters,
  initialFilters,
  type FilterState,
} from "./filters.js";
import { ErrorRows, ListCard, ListFooter, LoadingRows } from "./list-states.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { Term } from "./term.js";
import { TabItem, Tabs, TabsList } from "./ui/tabs.js";

/** Icon slot for a Tabs item: the Commit State's dot (theme token hue). */
function WalDot() {
  return <EvidenceDot state="wal" />;
}

function JournalDot() {
  return <EvidenceDot state="journal" />;
}

/** Committed or sidecar Finding list; each list pins exactly one Commit State. */
function FindingList({
  config,
  base,
  commitStates,
  title,
  onSelect,
}: {
  readonly config: ArtifactConfig;
  readonly base: QueryParameters;
  readonly commitStates: readonly CommitState[];
  readonly title: ReactNode;
  readonly onSelect: (row: Finding) => void;
}) {
  const [commitState, setCommitState] = useState<CommitState>(
    commitStates[0] ?? "committed",
  );
  const parameters = useMemo<QueryParameters>(
    () =>
      commitStates.length === 0
        ? base
        : [...base, ["commit-state", commitState]],
    [base, commitStates.length, commitState],
  );
  const list = usePaginatedList<Finding>(config.route, parameters);

  return (
    <ListCard
      title={title}
      count={list.rows.length}
      titleExtra={
        commitStates.length > 1 ? (
          <Tabs
            size="compact"
            value={commitState}
            onValueChange={(next) => {
              setCommitState(next as CommitState);
            }}
            className="ml-auto"
          >
            <TabsList aria-label="Recovered-from">
              {commitStates.map((state) => (
                <TabItem
                  key={state}
                  value={state}
                  icon={state === "wal_resident" ? WalDot : JournalDot}
                  label={COMMIT_META[state].label}
                />
              ))}
            </TabsList>
          </Tabs>
        ) : null
      }
    >
      {list.error !== null ? (
        <ErrorRows message={list.error} onRetry={list.retry} />
      ) : list.loading && list.rows.length === 0 ? (
        <LoadingRows />
      ) : (
        <FindingsTable rows={list.rows} onSelect={onSelect} />
      )}
      <ListFooter
        count={list.rows.length}
        cursor={list.cursor}
        loading={list.loading}
        onLoadMore={list.loadMore}
      />
    </ListCard>
  );
}

export function ArtifactPage({
  config,
  completeness,
  profiles,
}: {
  readonly config: ArtifactConfig;
  readonly completeness: CaseCompleteness;
  readonly profiles: readonly string[];
}) {
  const [filters, setFilters] = useState<FilterState>(() =>
    initialFilters(config),
  );
  const [selected, setSelected] = useState<SelectedRow | null>(null);

  useEffect(() => {
    setFilters(initialFilters(config));
    setSelected(null);
  }, [config]);

  const base = useMemo(() => filterParameters(filters), [filters]);
  const statement = completeness.statements.find(
    (entry) => entry.artifact === config.completenessArtifact,
  );

  return (
    <div className="flex flex-col gap-5">
      <CompletenessPanel statement={statement} />

      <FilterBar
        config={config}
        profiles={profiles}
        filters={filters}
        onChange={setFilters}
      />

      {config.combinedFindingList === true ? (
        <FindingList
          config={config}
          base={base}
          // Cache returns committed and recovered rows together; requesting a
          // commit-state it does not support would duplicate the same evidence.
          commitStates={[]}
          title="Cache records"
          onSelect={(row) => {
            setSelected({ kind: "finding", row });
          }}
        />
      ) : (
        <>
          <FindingList
            config={config}
            base={base}
            commitStates={["committed"]}
            title={
              <Term
                label="Saved records"
                technical="Technical: Commit State committed"
              >
                Rows Chrome had fully saved in its database — normal data.
              </Term>
            }
            onSelect={(row) => {
              setSelected({ kind: "finding", row });
            }}
          />
          <FindingList
            config={config}
            base={base}
            commitStates={SIDECAR_STATES}
            title={
              <Term
                label="Recovered records"
                technical="Technical: WAL / rollback-journal sidecars"
              >
                Rows the analyzer recovered from Chrome's temporary files — data
                that was unsaved, deleted, or being overwritten when Chrome
                stopped.
              </Term>
            }
            onSelect={(row) => {
              setSelected({ kind: "finding", row });
            }}
          />
        </>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
