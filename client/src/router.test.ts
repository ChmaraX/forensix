import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCATION,
  formatLocation,
  isDay,
  normalizeRange,
  pageLabelOf,
  parseLocation,
  rowRefOf,
  withPage,
  type ViewLocation,
} from "./router.js";

const FULL: ViewLocation = {
  page: "history",
  from: "2024-03-12",
  to: "2024-03-14",
  profiles: ["Default", "Profile 2"],
  host: "teamviewer.com",
  q: "https://example.com/a?b=c&d=e#f",
  tab: "recovered",
  row: "src-01/manifest.jsonl|visits|500106|Default|wal_resident",
};

describe("parseLocation / formatLocation", () => {
  it("round-trips every part of a view", () => {
    expect(parseLocation(formatLocation(FULL))).toEqual(FULL);
  });

  it("round-trips the default view and writes it short", () => {
    expect(formatLocation(DEFAULT_LOCATION)).toBe("#/overview");
    expect(parseLocation("#/overview")).toEqual(DEFAULT_LOCATION);
  });

  it("round-trips names that need escaping", () => {
    const view: ViewLocation = {
      ...DEFAULT_LOCATION,
      page: "top-sites",
      profiles: ["Profile 3 (Guest)", "Ünïcødé & co"],
      row: "a|b c|1|Profile 3 (Guest)|committed",
    };
    expect(parseLocation(formatLocation(view))).toEqual(view);
  });

  it("writes parameters in one fixed order", () => {
    expect(formatLocation(FULL)).toBe(
      "#/history?from=2024-03-12&to=2024-03-14&profile=Default&profile=Profile+2&host=teamviewer.com&q=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc%26d%3De%23f&tab=recovered&row=src-01%2Fmanifest.jsonl%7Cvisits%7C500106%7CDefault%7Cwal_resident",
    );
  });

  it("reads an empty or bare hash as the Overview", () => {
    expect(parseLocation("")).toEqual(DEFAULT_LOCATION);
    expect(parseLocation("#")).toEqual(DEFAULT_LOCATION);
    expect(parseLocation("#/")).toEqual(DEFAULT_LOCATION);
  });

  it("falls back per part on unknown or malformed input", () => {
    const parsed = parseLocation(
      "#/nowhere?from=2024-02-30&to=yesterday&tab=deleted&profile=&host=",
    );
    expect(parsed).toEqual(DEFAULT_LOCATION);
    expect(parseLocation("#/%E0%A4%A").page).toBe("overview");
  });

  it("puts a reversed range in order", () => {
    const parsed = parseLocation("#/timeline?from=2024-03-14&to=2024-03-12");
    expect([parsed.from, parsed.to]).toEqual(["2024-03-12", "2024-03-14"]);
  });

  it("keeps an open-ended range open", () => {
    const parsed = parseLocation("#/timeline?from=2024-03-12");
    expect([parsed.from, parsed.to]).toEqual(["2024-03-12", ""]);
    expect(parseLocation(formatLocation(parsed))).toEqual(parsed);
  });

  it("drops repeated profiles", () => {
    expect(
      parseLocation("#/history?profile=Default&profile=Default").profiles,
    ).toEqual(["Default"]);
  });
});

describe("isDay / normalizeRange", () => {
  it("accepts only real calendar days", () => {
    expect(isDay("2024-02-29")).toBe(true);
    expect(isDay("2023-02-29")).toBe(false);
    expect(isDay("2024-3-1")).toBe(false);
  });

  it("drops invalid sides", () => {
    expect(normalizeRange("x", "2024-03-01")).toEqual({
      from: "",
      to: "2024-03-01",
    });
  });
});

describe("withPage", () => {
  it("carries the lens and starts the page's own state over", () => {
    expect(withPage(FULL, "sites", { host: "gmail.com" })).toEqual({
      ...DEFAULT_LOCATION,
      page: "sites",
      from: FULL.from,
      to: FULL.to,
      profiles: FULL.profiles,
      host: "gmail.com",
    });
  });

  it("starts the page on show over too", () => {
    expect(withPage(FULL, "history").row).toBeNull();
    expect(withPage(FULL, "history").tab).toBe("saved");
  });
});

describe("pageLabelOf", () => {
  it("names every nav page and nothing else", () => {
    expect(pageLabelOf("credentials")).toBe("Saved logins");
    expect(pageLabelOf("sites")).toBe("Sites");
    expect(pageLabelOf("nope")).toBeNull();
  });
});

describe("rowRefOf", () => {
  it("joins the source chain, profile and Commit State", () => {
    expect(
      rowRefOf({
        profile: "Default",
        commitState: "committed",
        provenance: {
          manifestPath: "src/manifest.jsonl",
          table: "visits",
          rowId: "7",
        },
      }),
    ).toBe("src/manifest.jsonl|visits|7|Default|committed");
  });

  it("has no reference without a table or row id", () => {
    expect(
      rowRefOf({
        profile: "Default",
        commitState: "committed",
        provenance: { table: "visits" },
      }),
    ).toBeNull();
  });

  it("tells saved and recovered copies of one row id apart", () => {
    const base = {
      profile: "Default",
      provenance: { manifestPath: "m", table: "visits", rowId: "7" },
    };
    expect(rowRefOf({ ...base, commitState: "committed" })).not.toBe(
      rowRefOf({ ...base, commitState: "wal_resident" }),
    );
  });
});
