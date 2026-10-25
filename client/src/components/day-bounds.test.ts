import { describe, expect, it } from "vitest";

import {
  caseDayOf,
  caseDayTotals,
  dayRangeBounds,
  dayRangeParameters,
  fieldZone,
  inCaseDays,
  localDayOf,
  zonesNote,
} from "./day-bounds.js";

describe("dayRangeBounds", () => {
  it("uses UTC days without a declared timezone", () => {
    expect(
      dayRangeBounds({ from: "2024-03-04", to: "2024-03-04" }, null),
    ).toEqual({
      from: "2024-03-04T00:00:00.000Z",
      to: "2024-03-04T23:59:59.999999Z",
    });
  });

  it("falls back to UTC for a zone Intl does not know", () => {
    expect(
      dayRangeBounds({ from: "2024-03-04", to: "" }, "Not/AZone").from,
    ).toBe("2024-03-04T00:00:00.000Z");
  });

  it("bounds a day on the declared zone's clock", () => {
    // New York is UTC-5 in January.
    expect(
      dayRangeBounds(
        { from: "2024-01-15", to: "2024-01-15" },
        "America/New_York",
      ),
    ).toEqual({
      from: "2024-01-15T05:00:00.000Z",
      to: "2024-01-16T04:59:59.999999Z",
    });
    // Tokyo is UTC+9.
    expect(
      dayRangeBounds({ from: "2024-01-15", to: "2024-01-16" }, "Asia/Tokyo"),
    ).toEqual({
      from: "2024-01-14T15:00:00.000Z",
      to: "2024-01-16T14:59:59.999999Z",
    });
  });

  it("follows a daylight-saving change inside the range", () => {
    // New York moved to UTC-4 on 10 Mar 2024 at 02:00 local.
    expect(
      dayRangeBounds(
        { from: "2024-03-10", to: "2024-03-10" },
        "America/New_York",
      ),
    ).toEqual({
      from: "2024-03-10T05:00:00.000Z",
      to: "2024-03-11T03:59:59.999999Z",
    });
  });

  it("starts a day whose midnight a clock change skips when it begins", () => {
    // Santiago skipped 00:00-01:00 on 8 Sep 2024 (UTC-4 to UTC-3).
    expect(
      dayRangeBounds({ from: "2024-09-08", to: "" }, "America/Santiago").from,
    ).toBe("2024-09-08T04:00:00.000Z");
  });

  it("leaves open sides open", () => {
    expect(dayRangeParameters({ from: "", to: "" }, "Asia/Tokyo")).toEqual([]);
    expect(dayRangeParameters({ from: "", to: "2024-01-15" }, null)).toEqual([
      ["to", "2024-01-15T23:59:59.999999Z"],
    ]);
  });

  it("round-trips: every instant of the bounds reads as the picked day", () => {
    const zone = "America/New_York";
    const { from, to } = dayRangeBounds(
      { from: "2024-07-04", to: "2024-07-04" },
      zone,
    );
    expect(localDayOf(from, zone)).toBe("2024-07-04");
    expect(localDayOf(to, zone)).toBe("2024-07-04");
    const before = new Date(Date.parse(from ?? "") - 1).toISOString();
    const after = new Date(Date.parse(to ?? "") + 1).toISOString();
    expect(localDayOf(before, zone)).toBe("2024-07-03");
    expect(localDayOf(after, zone)).toBe("2024-07-05");
  });
});

describe("localDayOf", () => {
  it("reads a UTC instant as the zone's day", () => {
    expect(localDayOf("2024-01-16T03:00:00.000000Z", "America/New_York")).toBe(
      "2024-01-15",
    );
    expect(localDayOf("2024-01-16T03:00:00.000000Z", null)).toBe("2024-01-16");
  });

  it("returns null for no instant or an unparseable one", () => {
    expect(localDayOf(null, "UTC")).toBeNull();
    expect(localDayOf("not a time", "UTC")).toBeNull();
  });
});

describe("Case-day bucketing of loaded rows", () => {
  // 23:30 in New York on 4 Mar is 04:30 UTC on 5 Mar.
  const late = "2024-03-05T04:30:00.000000Z";
  const rows = [
    { utc: late, bytes: 100 },
    { utc: "2024-03-05T15:00:00.000000Z", bytes: 50 },
    { utc: null, bytes: 999 },
    { utc: "not a time", bytes: 7 },
  ];

  it("reads a row's day on the Case's clock, UTC without a zone", () => {
    expect(caseDayOf(late, "America/New_York")).toBe("2024-03-04");
    expect(caseDayOf(late, null)).toBe("2024-03-05");
    expect(caseDayOf(late, "Not/AZone")).toBe("2024-03-05");
  });

  it("buckets per Case day with counts and summed weights", () => {
    expect(
      caseDayTotals(
        rows,
        (row) => row.utc,
        () => "America/New_York",
        (row) => row.bytes,
      ),
    ).toEqual([
      { date: "2024-03-04", count: 1, weight: 100 },
      { date: "2024-03-05", count: 1, weight: 50 },
    ]);
    expect(
      caseDayTotals(
        rows,
        (row) => row.utc,
        () => null,
      ),
    ).toEqual([{ date: "2024-03-05", count: 2, weight: 0 }]);
  });

  it("buckets each row on the clock its own timestamp declares", () => {
    // The same instant falls on 4 Mar for a New York run, 5 Mar for a UTC
    // one: no single Case zone is applied to both.
    const mixed = [
      { utc: late, zone: "America/New_York" },
      { utc: late, zone: null },
    ];
    expect(
      caseDayTotals(
        mixed,
        (row) => row.utc,
        (row) => row.zone,
      ),
    ).toEqual([
      { date: "2024-03-04", count: 1, weight: 0 },
      { date: "2024-03-05", count: 1, weight: 0 },
    ]);
    expect(zonesNote(mixed.map((row) => row.zone))).toContain(
      "America/New_York",
    );
    expect(zonesNote(["Europe/Warsaw", "Europe/Warsaw"])).toBeNull();
  });

  it("reads the zone a timestamp field declares, null when none", () => {
    expect(
      fieldZone({
        state: "value",
        value: { utc: late, raw: "1", declaredTimezone: "Asia/Tokyo" },
      }),
    ).toBe("Asia/Tokyo");
    expect(fieldZone({ state: "value", value: { utc: late } })).toBeNull();
    expect(fieldZone({ state: "absent" })).toBeNull();
  });

  it("filters by the same days the chart draws", () => {
    const day = { from: "2024-03-04", to: "2024-03-04" };
    expect(inCaseDays(late, day, "America/New_York")).toBe(true);
    expect(inCaseDays(late, day, null)).toBe(false);
    expect(inCaseDays(late, { from: "2024-03-05", to: "" }, null)).toBe(true);
    // The full span holds every row; a set range never holds an undated one.
    expect(inCaseDays(null, { from: "", to: "" }, null)).toBe(true);
    expect(inCaseDays(null, { from: "", to: "2024-03-09" }, null)).toBe(false);
  });

  it("agrees with the server bounds of the same day", () => {
    const zone = "Asia/Tokyo";
    const { from, to } = dayRangeBounds(
      { from: "2024-01-15", to: "2024-01-15" },
      zone,
    );
    const range = { from: "2024-01-15", to: "2024-01-15" };
    expect(inCaseDays(from, range, zone)).toBe(true);
    expect(inCaseDays(to, range, zone)).toBe(true);
    expect(
      inCaseDays(
        new Date(Date.parse(from ?? "") - 1).toISOString(),
        range,
        zone,
      ),
    ).toBe(false);
  });
});
