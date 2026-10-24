import { describe, expect, it } from "vitest";

import {
  dayRangeBounds,
  dayRangeParameters,
  localDayOf,
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
