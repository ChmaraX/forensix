/**
 * Timeline: the chronological stream across artifacts. The page-visits
 * chart (the records' date filter), then the records; coverage of every
 * artifact the timeline merges is the shell's indicator by the title. The timeline route has no Commit State filter, so the
 * records panel splits the loaded stream into saved and recovered events
 * (`splitByCommit`) — two lists, each still in time order (forensic rule 4).
 */
import { useMemo, useState } from "react";

import type { QueryParameters } from "../api.js";
import type { Finding } from "../types.js";
import { usePaginatedList } from "../use-paginated-list.js";
import { useActivity } from "./activity-data.js";
import { dayRangeParameters } from "./day-bounds.js";
import { RowSheet, secretFieldsOf, type SelectedRow } from "./row-sheet.js";
import { TimelineActivityCard, type DayRange } from "./timeline-activity.js";
import {
  TimelineRecordsCard,
  timelineEventLabel,
  type TimelineDirection,
} from "./timeline-table.js";

export function TimelinePage() {
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [range, setRange] = useState<DayRange>({ from: "", to: "" });
  const [direction, setDirection] = useState<TimelineDirection>("desc");
  // The chart's days are the Case's own days (core buckets activity in the
  // declared timezone of the Analysis Run), so a picked range goes to the
  // server as the first and last instant of those local days: clicking day D
  // lists exactly day D. Without one declared timezone the bounds are UTC
  // days (see `dayRangeBounds`). Only the bounds depend on the zone, so the
  // unranged list does not re-read when the activity lands.
  const activity = useActivity();
  const timeZone = activity.activity?.timeZone ?? null;
  const parameters = useMemo<QueryParameters>(
    () => [["direction", direction], ...dayRangeParameters(range, timeZone)],
    [range, direction, timeZone],
  );
  const list = usePaginatedList<Finding>("timeline", parameters);

  return (
    <div className="flex flex-col gap-5">
      <TimelineActivityCard
        range={range}
        onRangeChange={setRange}
        read={activity}
      />
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
