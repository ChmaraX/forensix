import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { ForensixError } from "./errors.js";
import { recordedStrings, siteHostsOf } from "./site-host-key.js";
import {
  openSitesCase,
  parseFieldState,
  readingJson,
  schemaExists,
} from "./sites-query.js";

export interface SiteFaviconsQuery {
  readonly caseDirectory: string;
  /** Sites host keys (`siteHostKey`), at most {@link SITE_FAVICON_HOST_LIMIT}. */
  readonly hosts: readonly string[];
}

export interface SiteFaviconsResult {
  readonly status: "ok";
  readonly command: "site-favicons";
  /**
   * Per requested host: the recovered icon as a `data:` URI, or null when
   * the Case's saved Favicons hold no readable bitmap for that host. (Whether
   * Favicons were analysed at all is the Completeness statement's to say.)
   */
  readonly icons: Readonly<Record<string, string | null>>;
}

/** Most hosts one request may name (the shared 1-100 page bound). */
export const SITE_FAVICON_HOST_LIMIT = 100;

/**
 * Sniffs the image container from its leading bytes. The recovered favicon
 * payload carries no format field of its own - Chrome writes
 * `favicon_bitmaps.image_data` as whichever container the site served,
 * historically almost always PNG but never guaranteed. Unrecognized bytes
 * fall back to PNG, the overwhelming common case, rather than dropping the
 * icon entirely.
 */
function sniffImageMimeType(bytes: Buffer): string {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (bytes.length >= 3 && bytes.toString("ascii", 0, 3) === "GIF")
    return "image/gif";
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    bytes[3] === 0x00
  )
    return "image/x-icon";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return "image/png";
}

function isInside(root: string, path: string): boolean {
  const between = relative(root, path);
  return between !== "" && !between.startsWith("..") && !isAbsolute(between);
}

/** The payload as a `data:` URI, or null when the recorded path leaves the
 *  Case directory (lexically or through a link) or cannot be read. */
function payloadDataUri(caseRoot: string, payloadPath: string): string | null {
  const lexical = resolve(caseRoot, payloadPath);
  if (!isInside(caseRoot, lexical)) return null;
  try {
    const real = realpathSync(lexical);
    if (!isInside(caseRoot, real)) return null;
    const bytes = readFileSync(real);
    return `data:${sniffImageMimeType(bytes)};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Each host's recovered favicon, read from the Case's own saved favicon
 * payloads (never fetched live): the widest committed bitmap whose icon URL
 * or page URLs are on the host (`SITE_HOST_FIELDS`), ties to the lowest
 * Finding id. Every row is considered, widest first, until each host has
 * an icon; a bitmap whose payload is missing or unreadable gives way to the
 * next. WAL- and journal-resident rows never decorate a host.
 */
export function querySiteFavicons(
  input: SiteFaviconsQuery,
): SiteFaviconsResult {
  if (input.hosts.length > SITE_FAVICON_HOST_LIMIT)
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Sites favicons take at most ${String(SITE_FAVICON_HOST_LIMIT)} hosts.`,
      { hosts: input.hosts.length },
    );
  const icons: Record<string, string | null> = {};
  const wanted = new Map<string, string[]>();
  for (const requested of input.hosts) {
    icons[requested] = null;
    const key = requested.toLocaleLowerCase("en-US");
    wanted.set(key, [...(wanted.get(key) ?? []), requested]);
  }
  const database = openSitesCase(input.caseDirectory);
  try {
    if (
      !schemaExists(database, "favicon_findings") ||
      !schemaExists(database, "favicon_artifact_results")
    )
      throw new ForensixError(
        "ANALYSIS_NOT_FOUND",
        "Case has no Favicons analysis. Run analyse first.",
      );
    const caseRoot = realpathSync(resolve(input.caseDirectory));
    readingJson("favicon_findings", () => {
      if (wanted.size === 0) return;
      const rows = database
        .prepare(
          `SELECT f.sort_icon_url AS icon_url, json_extract(f.fields_json, '$.pageUrls') AS page_urls, json_extract(f.fields_json, '$.payloadPath') AS payload_path FROM favicon_findings f JOIN favicon_artifact_results r ON r.artifact_result_id = f.artifact_result_id WHERE r.active = 1 AND f.record_type = 'finding' AND f.finding_kind = 'favicon' AND f.commit_state = 'committed' ORDER BY COALESCE(f.sort_width, -1) DESC, f.finding_id ASC`,
        )
        .iterate();
      for (const row of rows) {
        const payloadPath = recordedStrings(
          parseFieldState(row.payload_path, "favicon_findings"),
        )[0];
        if (payloadPath === undefined) continue;
        const hosts = siteHostsOf("favicon", {
          iconUrl:
            typeof row.icon_url === "string"
              ? { state: "value", value: row.icon_url }
              : undefined,
          pageUrls: parseFieldState(row.page_urls, "favicon_findings"),
        });
        let uri: string | null | undefined;
        for (const host of hosts.keys()) {
          const requested = wanted.get(host);
          if (requested === undefined) continue;
          uri ??= payloadDataUri(caseRoot, payloadPath);
          if (uri === null) break;
          for (const name of requested) icons[name] = uri;
          wanted.delete(host);
        }
        if (wanted.size === 0) break;
      }
    });
    return { status: "ok", command: "site-favicons", icons };
  } finally {
    database.close();
  }
}
