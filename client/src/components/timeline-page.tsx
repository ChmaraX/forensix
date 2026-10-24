/**
 * Timeline: one chronological stream across artifacts, never split by Commit
 * State (splitting would hide chronology). Moved out of app.tsx unchanged.
 */
import { useMemo, useState } from "react";

import type { QueryParameters } from "../api.js";
import type { Finding } from "../types.js";
import { usePaginatedList } from "../use-paginated-list.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { TimelineActivityCard, type DayRange } from "./timeline-activity.js";
import {
  TimelineRecordsCard,
  type TimelineDirection,
} from "./timeline-table.js";

export function TimelinePage() {
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
    <div className="flex flex-col gap-4">
      <TimelineActivityCard range={range} onRangeChange={setRange} />
      {/* This stays one stream: splitting commit states would hide chronology. */}
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
      />
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
