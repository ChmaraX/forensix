import { describe, expect, it } from "vitest";

import type { FieldState, Finding } from "../types.js";
import { cacheResourceUrl, cacheSiteKey } from "./cache-keys.js";
import { hostFieldsOf } from "./sites-host-fields.js";

const value = (v: unknown): FieldState => ({ state: "value", value: v });

function finding(
  findingKind: string,
  fields: Record<string, FieldState>,
): Finding {
  return {
    recordType: "finding",
    findingKind,
    profile: "Default",
    commitState: "committed",
    provenance: { manifestPath: "m.jsonl", table: "t", rowId: "1" },
    fields,
  };
}

describe("cacheResourceUrl", () => {
  it("reads a plain URL key as itself", () => {
    expect(cacheResourceUrl("https://www.example.com/a.js")).toBe(
      "https://www.example.com/a.js",
    );
  });

  it("reads the resource past a double-keyed scope prefix", () => {
    expect(
      cacheResourceUrl(
        "1/0/_dk_https://top.example https://frame.example https://cdn.example/x.js",
      ),
    ).toBe("https://cdn.example/x.js");
  });

  it("reads a single scoped part past its prefix", () => {
    expect(cacheResourceUrl("1/0/https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  it("reads nothing from a key that names no URL", () => {
    expect(cacheResourceUrl("not a url")).toBeNull();
    expect(cacheResourceUrl(null)).toBeNull();
  });

  it("keys the resource host as Sites does", () => {
    expect(
      cacheSiteKey(
        finding("cache_entry", {
          key: value("_dk_https://top.example https://WWW.Example.com/x"),
        }),
      ),
    ).toBe("www.example.com");
    expect(
      cacheSiteKey(
        finding("cache_entry", { key: { state: "unavailable", reason: "x" } }),
      ),
    ).toBeNull();
  });
});

describe("hostFieldsOf", () => {
  const download = finding("download", {
    urlChain: value([
      "https://dl.example.com/file.exe",
      "https://www.example.com/file.exe",
    ]),
    originalUrl: value("https://dl.example.com/file.exe"),
    finalUrl: value("https://www.example.com/file.exe"),
    referrer: value("https://example.com/"),
    tabUrl: value("https://other.test/"),
    siteUrl: value("https://example.com/"),
  });

  it("names every URL field recorded on exactly the host", () => {
    expect(hostFieldsOf(download, "www.example.com")).toEqual(["urlChain"]);
    expect(hostFieldsOf(download, "example.com")).toEqual(["referrer"]);
    expect(hostFieldsOf(download, "other.test")).toEqual(["tabUrl"]);
  });

  it("never counts a partial host match", () => {
    expect(hostFieldsOf(download, "dl.example.com")).toEqual(["urlChain"]);
    expect(hostFieldsOf(download, "ample.com")).toEqual([]);
  });

  it("names a chain end only when there is no chain", () => {
    const noChain = finding("download", {
      urlChain: { state: "absent" },
      finalUrl: value("https://www.example.com/f"),
    });
    expect(hostFieldsOf(noChain, "www.example.com")).toEqual(["finalUrl"]);
  });

  it("reads a favicon's icon URL and page URLs", () => {
    const favicon = finding("favicon", {
      iconUrl: { state: "unavailable", reason: "related row missing" },
      pageUrls: value(["https://gmail.com/mail/", "https://x.test/"]),
    });
    expect(hostFieldsOf(favicon, "gmail.com")).toEqual(["pageUrls"]);
    expect(hostFieldsOf(favicon, "mail.gmail.com")).toEqual([]);
  });

  it("puts a cache entry on its resource's host", () => {
    const entry = finding("cache_entry", {
      key: value("https://www.example.com/x.js"),
    });
    expect(hostFieldsOf(entry, "www.example.com")).toEqual(["key"]);
    // No domain expansion: www is a host apart.
    expect(hostFieldsOf(entry, "example.com")).toEqual([]);
    expect(hostFieldsOf(entry, "other.test")).toEqual([]);
  });
});
