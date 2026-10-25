import { describe, expect, it } from "vitest";

import {
  capMatches,
  dayKeywords,
  entryDescription,
  fileEntriesOf,
  matchesQuery,
  usernameEntriesOf,
} from "./command-index.js";
import type { FieldState, Finding } from "./types.js";

const value = (v: unknown): FieldState => ({ state: "value", value: v });

function finding(
  findingKind: string,
  fields: Record<string, FieldState>,
  extra: Partial<Finding> = {},
): Finding {
  return {
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

const findsDay = (query: string) =>
  matchesQuery(["12 Mar 2024", ...dayKeywords("2024-03-12")], query);

describe("dayKeywords / matchesQuery", () => {
  it("finds a Case day typed in ISO or table format, either order, short or long", () => {
    for (const query of [
      "2024-03-12",
      "12 Mar",
      "Mar 12",
      "12 mar 2024",
      "march 12",
      "12 March",
    ]) {
      expect(findsDay(query)).toBe(true);
    }
  });

  it("does not find another day", () => {
    expect(findsDay("13 Mar")).toBe(false);
    expect(findsDay("2024-03-13")).toBe(false);
    expect(findsDay("12 Apr")).toBe(false);
  });

  it("keeps a malformed day as its own word", () => {
    expect(dayKeywords("someday")).toEqual(["someday"]);
  });

  it("matches every word, case-insensitively; empty matches all", () => {
    expect(matchesQuery(["Client_Ledger.xlsx"], "client_ledger")).toBe(true);
    expect(matchesQuery(["a b"], "")).toBe(true);
    expect(matchesQuery(["alpha"], "alpha beta")).toBe(false);
  });
});

describe("capMatches", () => {
  const words = ["one", "two", "three", "ten", "twenty"];
  it("lists the first matches in order and counts the rest", () => {
    expect(capMatches(words, "t", (w) => [w], 2)).toEqual({
      shown: ["two", "three"],
      more: 2,
    });
  });

  it("lists nothing for an empty query", () => {
    expect(capMatches(words, "  ", (w) => [w])).toEqual({ shown: [], more: 0 });
  });

  it("says no more when everything fits", () => {
    expect(capMatches(words, "one", (w) => [w])).toEqual({
      shown: ["one"],
      more: 0,
    });
  });
});

describe("fileEntriesOf", () => {
  it("indexes a download by its file name, with its host and reference", () => {
    const [entry] = fileEntriesOf([
      finding(
        "download",
        {
          targetPath: value("C:\\Users\\m\\Downloads\\client_ledger.xlsx"),
          tabUrl: value("https://mail.example.com/inbox"),
        },
        { commitState: "wal_resident", profile: "Profile 2" },
      ),
    ]);
    expect(entry).toEqual({
      name: "client_ledger.xlsx",
      path: "C:\\Users\\m\\Downloads\\client_ledger.xlsx",
      host: "mail.example.com",
      profile: "Profile 2",
      recovered: true,
      ref: "src-01/manifest.jsonl|t|7|Profile 2|wal_resident",
    });
  });

  it("skips a download with no path or no reference", () => {
    expect(fileEntriesOf([finding("download", {})])).toEqual([]);
    expect(
      fileEntriesOf([
        finding(
          "download",
          { targetPath: value("/a/b.zip") },
          { provenance: {} },
        ),
      ]),
    ).toEqual([]);
  });
});

describe("usernameEntriesOf", () => {
  it("keeps the username, the site and the reference - never the password", () => {
    const [entry] = usernameEntriesOf([
      finding("saved_login", {
        usernameValue: value("m.sandoval83@gmail.com"),
        originUrl: value("https://www.dropbox.com/login"),
        secret: value("hunter2"),
      }),
    ]);
    expect(entry).toEqual({
      username: "m.sandoval83@gmail.com",
      site: "www.dropbox.com",
      profile: "Default",
      recovered: false,
      ref: "src-01/manifest.jsonl|t|7|Default|committed",
    });
    expect(JSON.stringify(entry)).not.toContain("hunter2");
  });

  it("falls back to the signon realm for the site", () => {
    const [entry] = usernameEntriesOf([
      finding("saved_login", {
        usernameValue: value("omar"),
        signonRealm: value("android://hash@com.example/"),
      }),
    ]);
    expect(entry?.site).toBe("com.example");
  });

  it("skips a login with no recorded username", () => {
    expect(
      usernameEntriesOf([finding("saved_login", { usernameValue: value("") })]),
    ).toEqual([]);
  });
});

describe("entryDescription", () => {
  it("tells a recovered copy of a row from its saved one", () => {
    expect(entryDescription("teamviewer.com", "Profile 2", true)).not.toBe(
      entryDescription("teamviewer.com", "Profile 2", false),
    );
  });
});
