/**
 * Timeline: the chronological stream across artifacts. The page-visits
 * chart (the records' date filter), then the records; coverage of every
 * artifact the timeline merges is the shell's indicator by the title. The timeline route has no Commit State filter, so the
 * records panel splits the loaded stream into saved and recovered events
 * (`splitByCommit`) — two lists, each still in time order (forensic rule 4).
 * A row's sheet opens that row on its own artifact page
 * (`TimelineSourceLink`); the range, the tab and the open row are in the URL.
 */
import { useMemo, useState } from "react";

import { useRowSelection, useViewRange } from "../view-state.js";

import type { QueryParameters } from "../api.js";
import type { Finding } from "../types.js";
import { usePaginatedList } from "../use-paginated-list.js";
import { useActivity } from "./activity-data.js";
import { dayRangeParameters } from "./day-bounds.js";
import { formatDay, formatDaySpan } from "./page-kit.js";
import { RowSheet, secretFieldsOf } from "./row-sheet.js";
import { TimelineActivityCard } from "./timeline-activity.js";
import { TimelineSourceLink } from "./timeline-source-link.js";
import {
  TimelineRecordsCard,
  timelineRowTitle,
  type TimelineDirection,
} from "./timeline-table.js";

export function TimelinePage() {
  // The range is the Case-wide one (the shell's lens, in the URL).
  const [range, setRange] = useViewRange();
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
  // The open row lives in the URL: Back and a refresh re-open it.
  const sheet = useRowSelection(list.rows);

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
        onSelect={sheet.select}
        direction={direction}
        onDirectionChange={setDirection}
        rangeActive={range.from !== "" || range.to !== ""}
        rangeWords={
          range.from === "" || range.to === ""
            ? null
            : range.from === range.to
              ? `on ${formatDay(range.from)}`
              : `in ${formatDaySpan(range.from, range.to)}`
        }
        onClearRange={() => {
          setRange({ from: "", to: "" });
        }}
      />
      {sheet.selected !== null ? (
        <RowSheet
          selected={sheet.selected}
          title={timelineRowTitle(sheet.selected.row)}
          redactedFields={secretFieldsOf(sheet.selected.row)}
          onClose={sheet.close}
        >
          <TimelineSourceLink row={sheet.selected.row} />
        </RowSheet>
      ) : null}
    </div>
  );
}
