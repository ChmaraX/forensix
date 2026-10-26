/**
 * Timeline: the chronological stream across artifacts. The page-visits
 * chart (the records' date filter), then the records; coverage of every
 * artifact the timeline merges is the shell's indicator by the title. The timeline route has no Commit State filter, so the
 * records panel splits the loaded stream into saved and recovered events
 * (`splitByCommit`) — two lists, each still in time order (forensic rule 4).
 * A row's sheet opens that row on its own artifact page
 * (`TimelineSourceLink`); the range, the tab and the open row are in the URL
 * (a URL-named row past the loaded pages is looked up on the stream).
 */
import { useEffect, useMemo, useState } from "react";

import {
  useRowSelection,
  useViewProfiles,
  useViewRange,
} from "../view-state.js";
import { useCaseContext } from "../case-context.js";
import { profileLabel } from "./finding-fields.js";

import { callApi, type QueryParameters } from "../api.js";
import { FINDING_KINDS } from "../artifacts.js";
import type { PageOf } from "../types.js";
import { caseDayOf } from "./day-bounds.js";
import type { Finding } from "../types.js";
import type { RowLookupSource } from "../row-lookup.js";
import { usePaginatedList } from "../use-paginated-list.js";
import { bucketsOfProfiles, useActivity } from "./activity-data.js";
import { dayRangeParameters } from "./day-bounds.js";
import { RowSheet } from "./row-sheet.js";
import { TimelineActivityCard } from "./timeline-activity.js";
import { TimelineSourceLink } from "./timeline-source-link.js";
import {
  TimelineRecordsCard,
  timelineRowTitle,
  type TimelineDirection,
} from "./timeline-table.js";
import { fieldUtc } from "../field-readers.js";
import { formatDay, formatDaySpan } from "../day-format.js";

/** The event's own recorded instant (the kind's time field), or null. */
function eventUtc(row: Finding | undefined): string | null {
  if (row === undefined) {
    return null;
  }
  const field = FINDING_KINDS[row.findingKind]?.time;
  return field === undefined ? null : fieldUtc(row.fields[field]);
}

/**
 * The first and last Case day the stream records an event on (any kind -
 * a download on 1 Mar, a cookie set in February), from two one-row reads
 * of the unranged stream (oldest first, newest first). The chart's axis
 * and the picker span them, so a day with events but no page visit can be
 * picked too. Null ends until read (or when the read fails: the chart then
 * keeps the visits' own span).
 */
function useEventSpan(timeZone: string | null): {
  readonly min: string | null;
  readonly max: string | null;
} {
  const [ends, setEnds] = useState<{
    readonly first: string | null;
    readonly last: string | null;
  }>({ first: null, last: null });
  useEffect(() => {
    const abort = new AbortController();
    const one = (direction: "asc" | "desc") =>
      callApi<PageOf<Finding>>(
        "timeline",
        [
          ["direction", direction],
          ["limit", "1"],
        ],
        { signal: abort.signal },
      ).then((page) => eventUtc(page.items[0]));
    Promise.all([one("asc"), one("desc")])
      .then(([first, last]) => {
        setEnds({ first, last });
      })
      .catch(() => {
        // The chart keeps the visits' own span.
      });
    return () => {
      abort.abort();
    };
  }, []);
  return useMemo(
    () => ({
      min: caseDayOf(ends.first, timeZone),
      max: caseDayOf(ends.last, timeZone),
    }),
    [ends, timeZone],
  );
}

export function TimelinePage() {
  // The range is the Case-wide one (the shell's lens, in the URL).
  const [range, setRange] = useViewRange();
  const [direction, setDirection] = useState<TimelineDirection>("desc");
  // The chart's days are the Case's own days (core buckets activity in the
  // declared timezone of the Analysis Run), so a picked range goes to the
  // server as the first and last instant of those local days: clicking day D
  // lists exactly day D. Without one declared timezone (`null`) the bounds
  // are UTC days (see `dayRangeBounds`). Until the activity lands, or when
  // it failed (`undefined`), a ranged list waits, or shows that error:
  // its bounds are never guessed in UTC. Only the bounds depend on the
  // zone, so the unranged list does not re-read when the activity lands.
  const activity = useActivity();
  const timeZone =
    activity.activity === null ? undefined : activity.activity.timeZone;
  // The profile pick is a server filter (repeated `profile`): the stream
  // holds the picked profiles' events only, never a filter over the pages
  // loaded so far.
  const [profiles, setProfiles] = useViewProfiles();
  const { context } = useCaseContext();
  const parameters = useMemo<QueryParameters>(
    () => [
      ["direction", direction],
      ...dayRangeParameters(range, timeZone ?? null),
      ...profiles.map((profile) => ["profile", profile] as const),
    ],
    [range, direction, timeZone, profiles],
  );
  const zoneHeld =
    timeZone === undefined && (range.from !== "" || range.to !== "");
  const list = usePaginatedList<Finding>(
    "timeline",
    parameters,
    zoneHeld ? { error: activity.error, retry: activity.retry } : null,
  );
  const eventSpan = useEventSpan(timeZone ?? null);
  const rows = list.rows;
  // The chart draws the picked profiles' activity (each activity row
  // records its profile).
  const read = useMemo(
    () =>
      activity.activity === null || profiles.length === 0
        ? activity
        : {
            ...activity,
            activity: {
              ...activity.activity,
              saved: bucketsOfProfiles(activity.activity.saved, profiles),
              recovered: bucketsOfProfiles(
                activity.activity.recovered,
                profiles,
              ),
            },
          },
    [activity, profiles],
  );
  const profileOptions = useMemo(
    () =>
      [...new Set([...(context?.profiles ?? []), ...profiles])]
        .filter((profile) => profile !== "" && profile !== ".")
        .sort(),
    [context, profiles],
  );
  // The open row lives in the URL: Back and a refresh re-open it. A row
  // the stream has not loaded (a link into a large Case, a copied URL) is
  // looked up on the same stream by its id (its profile and Commit State
  // narrow the read), with the list's range: so not while the list waits.
  const lookup = useMemo<RowLookupSource | undefined>(
    () => (zoneHeld ? undefined : { route: "timeline", parameters }),
    [zoneHeld, parameters],
  );
  const sheet = useRowSelection(list.rows, lookup);

  return (
    <div className="flex flex-col gap-5">
      <TimelineActivityCard
        range={range}
        onRangeChange={setRange}
        read={read}
        eventSpan={eventSpan}
      />
      <TimelineRecordsCard
        rows={rows}
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
        profileOptions={profileOptions}
        profiles={profiles}
        onProfilesChange={setProfiles}
        profileWords={
          profiles.length === 0
            ? null
            : `in ${profiles.map(profileLabel).join(" or ")}`
        }
      />
      {sheet.selected !== null ? (
        <RowSheet
          selected={sheet.selected}
          title={timelineRowTitle(sheet.selected.row)}
          onClose={sheet.close}
        >
          <TimelineSourceLink row={sheet.selected.row} />
        </RowSheet>
      ) : null}
    </div>
  );
}
