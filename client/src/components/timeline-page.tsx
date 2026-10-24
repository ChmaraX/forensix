/**
 * Timeline: the chronological stream across artifacts. Evidence coverage
 * first (every artifact the timeline merges), then the activity widget, then
 * the records. The timeline route has no Commit State filter, so the
 * records panel splits the loaded stream into saved and recovered events
 * (`splitByCommit`) — two lists, each still in time order (forensic rule 4).
 */
import { useMemo, useState } from "react";

import type { QueryParameters } from "../api.js";
import type { CaseCompleteness, Finding } from "../types.js";
import { usePaginatedList } from "../use-paginated-list.js";
import { CompletenessPanel, TIMELINE_COVERAGE } from "./completeness.js";
import { RowSheet, secretFieldsOf, type SelectedRow } from "./row-sheet.js";
import { TimelineActivityCard, type DayRange } from "./timeline-activity.js";
import {
  TimelineRecordsCard,
  timelineEventLabel,
  type TimelineDirection,
} from "./timeline-table.js";

export function TimelinePage({
  completeness,
}: {
  readonly completeness: CaseCompleteness;
}) {
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [range, setRange] = useState<DayRange>({ from: "", to: "" });
  const [direction, setDirection] = useState<TimelineDirection>("desc");
  // A selected day range maps to whole-day UTC instants: local dates can read
  // up to a day wider than the true local bounds, which only ever widens the
  // window — it can never hide evidence.
  const parameters = useMemo<QueryParameters>(() => {
    const result: (readonly [string, string])[] = [["direction", direction]];
    if (range.from !== "") {
      result.push(["from", `${range.from}T00:00:00Z`]);
    }
    if (range.to !== "") {
      result.push(["to", `${range.to}T23:59:59.999999Z`]);
    }
    return result;
  }, [range, direction]);
  const list = usePaginatedList<Finding>("timeline", parameters);

  return (
    <div className="flex flex-col gap-5">
      <CompletenessPanel
        completeness={completeness}
        artifacts={TIMELINE_COVERAGE}
      />
      <TimelineActivityCard range={range} onRangeChange={setRange} />
      <TimelineRecordsCard
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        cursor={list.cursor}
        onLoadMore={list.loadMore}
        onRetry={list.retry}
        onSelect={(row) => {
          setSelected({ kind: "finding", row });
        }}
        direction={direction}
        onDirectionChange={setDirection}
        rangeActive={range.from !== "" || range.to !== ""}
        onClearRange={() => {
          setRange({ from: "", to: "" });
        }}
      />
      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={timelineEventLabel(selected.row.findingKind)}
          redactedFields={secretFieldsOf(selected.row)}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
