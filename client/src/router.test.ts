import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCATION,
  formatLocation,
  isDay,
  normalizeRange,
  parseLocation,
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
  filter: "Bookmarks bar/Work",
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

  it("gives one view one URL, whatever order a link wrote it in", () => {
    const hash = formatLocation({ ...FULL, profiles: ["Default"] });
    const query = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
    const reversed = new URLSearchParams([...query].reverse()).toString();
    expect(reversed).not.toBe(query.toString());
    expect(formatLocation(parseLocation(`#/history?${reversed}`))).toBe(hash);
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

  it("gives one profile pick one URL, whatever order it was made in", () => {
    const picked = (profiles: readonly string[]) =>
      formatLocation({ ...DEFAULT_LOCATION, page: "history", profiles });
    expect(picked(["Profile 2", "Default"])).toBe(
      picked(["Default", "Profile 2"]),
    );
    expect(
      parseLocation("#/history?profile=Profile+2&profile=Default").profiles,
    ).toEqual(["Default", "Profile 2"]);
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
