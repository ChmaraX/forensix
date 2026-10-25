import { describe, expect, it } from "vitest";

import { fieldLabel, spellFieldName } from "./field-labels.js";
import {
  citationOf,
  dayLinkOf,
  hostLinkOf,
  siteKeyOf,
  visitedUrlsOf,
  visitLinksOf,
  VISIT_LINKS,
} from "./related.js";
import type { FieldState, Finding } from "./types.js";

const value = (v: unknown): FieldState => ({ state: "value", value: v });
const time = (utc: string): FieldState => value({ utc, raw: "0" });

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
      rowId: "1",
    },
    fields,
    ...extra,
  };
}

describe("siteKeyOf", () => {
  it("keys a URL by its hostname, as Sites does", () => {
    expect(siteKeyOf("https://www.TeamViewer.com/download?x=1")).toBe(
      "www.teamviewer.com",
    );
  });

  it("keys a domain cookie's host key without its leading dot", () => {
    expect(siteKeyOf(".gmail.com")).toBe("gmail.com");
  });

  it("keys a host-only cookie's bare host key as itself", () => {
    expect(siteKeyOf("Example.com")).toBe("example.com");
    expect(siteKeyOf("www.google.com")).toBe("www.google.com");
    expect(siteKeyOf("[::1]")).toBe("[::1]");
  });

  it("expands no domain: www is a host apart", () => {
    expect(siteKeyOf("https://www.example.com/")).not.toBe(
      siteKeyOf("https://example.com/"),
    );
  });

  it("drops a port, which Sites does not key", () => {
    expect(siteKeyOf("http://localhost:8080/")).toBe("localhost");
    expect(siteKeyOf("http://[::1]:8080/")).toBe("[::1]");
  });

  it("reads nothing from a non-host", () => {
    expect(siteKeyOf(null)).toBeNull();
    expect(siteKeyOf("C:/Users/file.exe")).toBeNull();
    expect(siteKeyOf("not a url://")).toBeNull();
    expect(siteKeyOf("about:blank")).toBeNull();
    expect(siteKeyOf("example.com/path")).toBeNull();
    expect(siteKeyOf("")).toBeNull();
    expect(siteKeyOf(".")).toBeNull();
  });
});

describe("hostLinkOf", () => {
  it("links a visit to its host in Sites", () => {
    const link = hostLinkOf(
      finding("history_visit", { url: value("https://www.dropbox.com/h") }),
    );
    expect(link).toMatchObject({
      page: "sites",
      extras: { host: "www.dropbox.com" },
      field: "url",
    });
  });

  it("uses the next host field when the first is not recorded", () => {
    const link = hostLinkOf(
      finding("login_credential", {
        originUrl: { state: "absent" },
        signonRealm: value("https://accounts.example.org/"),
      }),
    );
    expect(link?.extras).toEqual({ host: "accounts.example.org" });
    expect(link?.field).toBe("signonRealm");
  });

  it("reads a cache entry's host from the resource its key names", () => {
    const link = hostLinkOf(
      finding("cache_entry", {
        key: value(
          "1/0/_dk_https://top.example https://frame.example https://cdn.Example.net/a.js",
        ),
      }),
    );
    expect(link).toMatchObject({
      extras: { host: "cdn.example.net" },
      field: "key",
    });
    // A key whose resource is no URL links nothing.
    expect(
      hostLinkOf(finding("cache_entry", { key: value("1/0/not-a-url") })),
    ).toBeNull();
  });

  it("links a favicon to its icon URL's host", () => {
    const link = hostLinkOf(
      finding("favicon", {
        iconUrl: value("https://www.github.com/favicon.ico"),
      }),
    );
    expect(link).toMatchObject({
      extras: { host: "www.github.com" },
      field: "iconUrl",
    });
  });

  it("never invents a host: unknown kinds and unrecorded fields link nothing", () => {
    expect(
      hostLinkOf(finding("autofill_entry", { fieldValue: value("x.com") })),
    ).toBeNull();
    expect(
      hostLinkOf(
        finding("history_visit", {
          url: { state: "unavailable", reason: "r" },
        }),
      ),
    ).toBeNull();
    expect(hostLinkOf(finding("history_visit", { url: value("") }))).toBeNull();
  });
});

describe("dayLinkOf", () => {
  const visit = finding("history_visit", {
    visitTime: time("2024-03-12T23:30:00.000Z"),
  });

  it("links the row's own day to the Timeline (UTC days without a zone)", () => {
    expect(dayLinkOf(visit, null)).toMatchObject({
      page: "timeline",
      extras: { from: "2024-03-12", to: "2024-03-12" },
      value: "12 Mar 2024",
      field: "visitTime",
    });
  });

  it("reads the day on the Case's declared clock", () => {
    expect(dayLinkOf(visit, "Europe/Warsaw")?.extras).toEqual({
      from: "2024-03-13",
      to: "2024-03-13",
    });
  });

  it("links nothing for an undated kind or an unrecorded time", () => {
    expect(
      dayLinkOf(finding("top_site", { url: value("https://a.b/") }), null),
    ).toBeNull();
    expect(
      dayLinkOf(
        finding("history_visit", { visitTime: { state: "absent" } }),
        null,
      ),
    ).toBeNull();
  });
});

describe("visitedUrlsOf / visitLinksOf", () => {
  const download = finding("download", {
    tabUrl: value("https://www.teamviewer.com/en/download/"),
    referrer: value("https://www.teamviewer.com/en/download/"),
    siteUrl: value("https://www.teamviewer.com/"),
  });

  it("lists each distinct visited URL once, with its first field", () => {
    expect(visitedUrlsOf(download)).toEqual([
      { field: "tabUrl", url: "https://www.teamviewer.com/en/download/" },
    ]);
  });

  const visitTo = (url: string, rowId: string, commitState = "committed") =>
    finding(
      "history_visit",
      { url: value(url), visitTime: time("2024-03-12T10:00:00.000Z") },
      {
        commitState: commitState as Finding["commitState"],
        provenance: { manifestPath: "m", table: "visits", rowId },
      },
    );

  it("links only visits whose URL is exactly the same string", () => {
    const url = "https://www.teamviewer.com/en/download/";
    const links = visitLinksOf(
      { field: "tabUrl", url },
      "download",
      [
        visitTo(url, "1"),
        visitTo(`${url}?utm=1`, "2"),
        visitTo("https://www.teamviewer.com/en/download", "3"),
        visitTo(url, "4", "wal_resident"),
      ],
      (utc) => utc,
    );
    expect(links.map((link) => link.extras.row)).toEqual([
      "m|visits|1|Default|committed",
      "m|visits|4|Default|wal_resident",
    ]);
    expect(links.map((link) => link.extras.tab)).toEqual([
      "saved",
      "recovered",
    ]);
    expect(links.every((link) => link.extras.q === url)).toBe(true);
    expect(links[0]?.label).toBe("Visit to Tab page");
  });

  it("links the rest through one History search past the first few", () => {
    const url = "https://a.example/";
    const visits = [
      ...Array.from({ length: VISIT_LINKS + 2 }, (_, index) =>
        visitTo(url, String(index)),
      ),
      visitTo(url, "r1", "wal_resident"),
    ];
    const links = visitLinksOf(
      { field: "url", url },
      "bookmark",
      visits,
      String,
    );
    expect(links).toHaveLength(VISIT_LINKS + 1);
    const rest = links[links.length - 1];
    expect(rest?.extras).toEqual({ q: url });
    // Saved and recovered visits are counted apart, never summed.
    expect(rest?.value).toContain("2 more saved visits");
    expect(rest?.value).toContain("1 more recovered visit");
    expect(rest?.value).not.toContain("3 more");
  });

  it("opens the Recovered tab when only recovered visits are left", () => {
    const url = "https://a.example/";
    const visits = [
      ...Array.from({ length: VISIT_LINKS }, (_, index) =>
        visitTo(url, String(index)),
      ),
      visitTo(url, "r1", "journal_resident"),
    ];
    const links = visitLinksOf(
      { field: "url", url },
      "bookmark",
      visits,
      String,
    );
    expect(links[links.length - 1]?.extras).toEqual({
      q: url,
      tab: "recovered",
    });
  });

  it("offers History searched for the URL when a cut-off read found no exact visit", () => {
    const url = "https://a.example/";
    const links = visitLinksOf(
      { field: "url", url },
      "bookmark",
      [visitTo(`${url}page`, "1")],
      String,
      true,
    );
    expect(links).toHaveLength(1);
    expect(links[0]?.extras).toEqual({ q: url });
    expect(links[0]?.page).toBe("history");
  });

  it("links nothing when no visit matches exactly", () => {
    expect(
      visitLinksOf(
        { field: "url", url: "https://a.example/" },
        "bookmark",
        [visitTo("https://a.example", "1")],
        String,
      ),
    ).toEqual([]);
  });
});

describe("citationOf", () => {
  it("cites provenance, Commit State and a content hash only", () => {
    const row = finding(
      "favicon",
      {
        payloadSha256: value("ab12"),
        iconUrl: value("https://x/favicon.ico"),
      },
      { commitState: "journal_resident" },
    );
    expect(
      citationOf(row, { artifact: "Favicons", profile: "Default profile" }),
    ).toBe(
      "Artifact: Favicons (favicon) · Profile: Default profile · File: src-01/manifest.jsonl · Table: t · Row id: 1 · Commit State: journal_resident · payloadSha256: ab12",
    );
  });

  it("never carries a secret or any other field value", () => {
    const row = finding("cookie", {
      value: value("SESSION=secret-token"),
      name: value("sid"),
    });
    const citation = citationOf(row, {
      artifact: "Cookies",
      profile: "Default profile",
      redacted: ["value"],
    });
    expect(citation).not.toContain("secret-token");
    expect(citation).not.toContain("sid");
  });

  it("says absent for a part the row does not record", () => {
    const row = finding("cookie", {}, { provenance: {} });
    expect(
      citationOf(row, { artifact: null, profile: "Default profile" }),
    ).toContain("File: absent · Table: absent · Row id: absent");
  });
});

describe("fieldLabel", () => {
  it("reads a known field in words", () => {
    expect(fieldLabel("visitId")).toBe("Visit id");
    // The value says "bytes" (field-values.ts), so the label does not.
    expect(fieldLabel("totalBytes", "download")).toBe("Expected size");
  });

  it("prefers a kind-specific label", () => {
    expect(fieldLabel("state", "download")).toBe("Outcome");
    expect(fieldLabel("name", "cookie")).toBe("Cookie name");
  });

  it("spells out an unknown field", () => {
    expect(spellFieldName("someNewFieldUrl")).toBe("Some new field URL");
    expect(spellFieldName("lastSeenSha256")).toBe("Last seen SHA-256");
    expect(fieldLabel("brandNewThing")).toBe("Brand new thing");
  });
});
