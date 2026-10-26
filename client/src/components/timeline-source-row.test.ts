import { describe, expect, it } from "vitest";

import type { FieldState, Finding } from "../types.js";
import { splitUrlHost } from "./url-host.js";
import { sourceRowOf } from "./timeline-source-row.js";

const value = (v: unknown): FieldState => ({ state: "value", value: v });

function finding(
  findingKind: string,
  fields: Record<string, FieldState>,
  extra: Partial<Finding> = {},
): Finding {
  return {
    id: "history:7",
    recordType: "finding",
    findingKind,
    profile: "Default",
    commitState: "committed",
    provenance: {
      manifestPath: "src-01/manifest.jsonl",
      table: "t",
      rowId: "7",
    },
    fields,
    ...extra,
  };
}

describe("splitUrlHost", () => {
  it("splits the authority exactly as written", () => {
    expect(splitUrlHost("https://WWW.Example.com:8443/a?b#c")).toEqual({
      head: "https://",
      host: "WWW.Example.com:8443",
      tail: "/a?b#c",
    });
  });

  it("keeps userinfo outside the host", () => {
    expect(splitUrlHost("ftp://user:pw@files.example.org/x")).toEqual({
      head: "ftp://user:pw@",
      host: "files.example.org",
      tail: "/x",
    });
  });

  it("returns null without scheme://authority", () => {
    expect(splitUrlHost("about:blank")).toBeNull();
    expect(splitUrlHost("C:\\Users\\a.txt")).toBeNull();
  });
});

describe("sourceRowOf (Timeline row → its page row)", () => {
  const visit = finding("history_visit", {
    url: value("https://mail.example.com/inbox"),
  });

  it("opens the visit on History, searched for its URL", () => {
    const source = sourceRowOf(visit, []);
    expect(source?.page).toBe("history");
    expect(source?.label).toBe("History");
    expect(source?.extras).toEqual({
      row: "history:7",
      tab: "saved",
      q: "https://mail.example.com/inbox",
    });
  });

  it("opens a recovered download on the Recovered tab, no search", () => {
    const source = sourceRowOf(
      finding("download", {}, { commitState: "wal_resident" }),
      [],
    );
    expect(source?.page).toBe("downloads");
    expect(source?.extras.tab).toBe("recovered");
    expect(source?.extras.q).toBeUndefined();
  });

  it("adds the row's profile to a lens that leaves it out", () => {
    expect(sourceRowOf(visit, ["Profile 2"])?.extras.profiles).toEqual([
      "Profile 2",
      "Default",
    ]);
    expect(sourceRowOf(visit, ["Default"])?.extras.profiles).toBeUndefined();
  });
});
