#!/usr/bin/env node
/**
 * Design-only mock backend for the ForensiX dashboard client.
 *
 * Serves the built `client/dist/index.js` and every `/api/*` route the real
 * `server/src/index.ts` exposes, backed by the static fixture Case in
 * `case-data.mjs` instead of a real analyzed Case.
 *
 * This is NOT analyzer test data, is not started by any production code path,
 * and must never be imported by `server/`, `core/`, or `cli/`. It exists only
 * so the dashboard can be designed and iterated against rich, realistic data.
 *
 * Route contracts mirror the real server's validation (core's
 * `normalizeLimit`, cursors, sort / direction / view / commit-state /
 * `from`-`to` checks), so a client request the real server rejects is
 * rejected here too, with the same 400 body shape (`{status:"error", code,
 * message, details}`): `limit` must be an integer from 1 through 100
 * (default 50), every list is paged with a `nextCursor` while rows remain,
 * and a cursor from another query is INVALID_CURSOR. `commit-state` and
 * `from` / `to` filter where the real server applies them. Search, sort
 * order and the per-artifact extra filters are validated where core
 * validates them but not applied (see mock/README.md): enough to design
 * against, not to test ordering.
 *
 * Usage:
 *   node mock/server.mjs [--port 7799] [--bundle <path/to/index.js>] [--degraded]
 *
 * Degraded coverage: `--degraded` (or FORENSIX_MOCK_DEGRADED=1) makes every
 * `completeness` read report a degraded Completeness Statement — History
 * missing in one Profile, Cookies and Cache unreadable (database locked) —
 * on top of the fixture's own Form data gap (no Web Data in the Guest
 * profile). The data routes stay consistent with it: a database that was
 * not read serves no rows (its route, the Timeline and the Sites routes
 * drop them). Without the flag, open the dashboard as `/?degraded=1`: the
 * page URL rides each API call's Referer, so only that tab sees the
 * degraded Case.
 *
 * The bundle defaults to `client/dist/index.js`. `--bundle`, or the
 * FORENSIX_CLIENT_BUNDLE / FORENSIX_CLIENT_OUTDIR environment variables, point
 * it at a bundle built elsewhere, so several mock servers (one per port) can
 * each serve their own build.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { siteHostKey, siteHostsOf } from "../../core/src/site-host-key.ts";
import { caseData } from "./case-data.mjs";

const mockRoot = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(mockRoot, "..");

const HOST = "127.0.0.1";
const MOCK_TOKEN = "mock-token-design-only";

// Mirrors the real server's policy (server/src/index.ts), so a design that
// needs anything the shipped dashboard cannot load fails here first.
const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'self'";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function bundlePath() {
  const explicit = option("bundle", process.env.FORENSIX_CLIENT_BUNDLE);
  if (explicit !== undefined && explicit !== "") {
    return resolve(explicit);
  }
  const outDir = process.env.FORENSIX_CLIENT_OUTDIR;
  if (outDir !== undefined && outDir !== "") {
    return join(resolve(outDir), "index.js");
  }
  return join(clientRoot, "dist", "index.js");
}

const distIndexJs = bundlePath();

const port = Number(option("port", "7799"));

const ALWAYS_DEGRADED =
  process.argv.includes("--degraded") ||
  process.env.FORENSIX_MOCK_DEGRADED === "1";

/** True when this API call should see the degraded Completeness Statement:
 *  the server flag, or `?degraded=1` on the page that made the call. */
function wantsDegraded(request) {
  if (ALWAYS_DEGRADED) {
    return true;
  }
  const referer = request.headers.referer;
  if (typeof referer !== "string") {
    return false;
  }
  try {
    return new URL(referer).searchParams.get("degraded") === "1";
  } catch {
    return false;
  }
}

/** Artifacts the degraded statement reports unreadable in every Profile. */
const DEGRADED_UNREADABLE = ["Cookies", "Cache"];

/** The fixture's statement with more gaps: History absent in the second
 *  Profile, Cookies and Cache unreadable in every Profile. Design-only. */
function degradedCompleteness() {
  const statements = caseData.completeness.statements.map((statement) => {
    if (
      statement.artifact !== "History" &&
      !DEGRADED_UNREADABLE.includes(statement.artifact)
    ) {
      return statement;
    }
    const artifacts = statement.artifacts.map((entry, index) => {
      if (DEGRADED_UNREADABLE.includes(statement.artifact)) {
        return {
          ...entry,
          outcome: "unavailable",
          reason: "Database locked.",
        };
      }
      return index === 1
        ? {
            ...entry,
            outcome: "absent",
            reason: "Profile directory has no History database.",
          }
        : entry;
    });
    const count = (outcome) =>
      artifacts.filter((entry) => entry.outcome === outcome).length;
    return {
      ...statement,
      attempted: artifacts.length,
      produced: count("produced"),
      absent: count("absent"),
      unavailable: count("unavailable"),
      artifacts,
    };
  });
  return { ...caseData.completeness, statements };
}

/** The Completeness Statement this API call sees. */
function completenessFor(request) {
  return wantsDegraded(request)
    ? degradedCompleteness()
    : caseData.completeness;
}

/** "Artifact|Profile" for every database the call's statement says was not
 *  read (absent or unavailable). */
function unreadDatabases(request) {
  const unread = new Set();
  for (const statement of completenessFor(request).statements) {
    for (const entry of statement.artifacts) {
      if (entry.outcome !== "produced") {
        unread.add(`${statement.artifact}|${entry.profile}`);
      }
    }
  }
  return unread;
}

/** Rows of one Completeness artifact, less those from a database the call's
 *  statement says was not read — an unreadable artifact serves no rows. */
function readable(rows, artifact, request) {
  const unread = unreadDatabases(request);
  return unread.size === 0
    ? rows
    : rows.filter((row) => !unread.has(`${artifact}|${row.profile}`));
}

/* ------------------------------- HTML shell ------------------------------- */

function htmlShell() {
  const safeToken = JSON.stringify(MOCK_TOKEN);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ForensiX dashboard - design mock (${caseData.caseId})</title>
    <script>window.__FORENSIX_TOKEN__ = ${safeToken};</script>
    <script type="module" src="/index.js"></script>
  </head>
  <body>
    <div id="app">Loading read-only Case dashboard…</div>
  </body>
</html>
`;
}

/* ------------------------------ list wrapping ------------------------------ */

/** A 400 the real server would send: `INVALID_ARGUMENT` or `INVALID_CURSOR`
 *  (core's `ForensixError`, `server/src/index.ts` status mapping). */
class MockBadRequest extends Error {
  constructor(message, details = {}, code = "INVALID_ARGUMENT") {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/** Each list route's core label (used in core's error messages). */
const ROUTE_LABELS = {
  history: "History",
  timeline: "Timeline",
  cookies: "Cookies",
  credentials: "Credential",
  "top-sites": "Top Sites",
  cache: "Cache",
  favicons: "Favicons",
  candidates: "Candidates",
  "topic-candidates": "Topic Candidate",
  metadata: "Metadata",
  downloads: "Downloads",
  bookmarks: "Bookmarks",
  autofill: "Autofill",
  "site-hosts": "Sites",
  "site-findings": "Sites",
};

/** `limit` as the real server resolves it: the HTTP layer's integer check
 *  (`integerParameter`), then core's `normalizeLimit` (1-100, default 50). */
function resolveLimit(params, label) {
  const raw = params.get("limit");
  if (raw === null) {
    return 50;
  }
  if (!/^[0-9]+$/.test(raw)) {
    throw new MockBadRequest("Query parameter limit must be an integer.", {
      parameter: "limit",
      value: raw,
    });
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new MockBadRequest(
      `${label} --limit must be an integer from 1 through 100.`,
      { limit },
    );
  }
  return limit;
}

/** The query a cursor belongs to: route and every parameter but the page
 *  ones (`limit` is not in core's fingerprint either). */
function fingerprintOf(route, params) {
  const entries = [...params.entries()]
    .filter(([name]) => name !== "limit" && name !== "after")
    .sort(([a, av], [b, bv]) =>
      a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1,
    );
  return JSON.stringify([route, entries]);
}

function encodeCursor(fingerprint, offset) {
  return Buffer.from(
    JSON.stringify({ version: 1, fingerprint, offset }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value, fingerprint, label) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    parsed = undefined;
  }
  if (value === "" || parsed === undefined) {
    throw new MockBadRequest(
      `${label} cursor is not valid.`,
      {},
      "INVALID_CURSOR",
    );
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    parsed.version !== 1 ||
    parsed.fingerprint !== fingerprint ||
    !Number.isInteger(parsed.offset) ||
    parsed.offset < 0
  ) {
    throw new MockBadRequest(
      `${label} cursor does not belong to this query.`,
      {},
      "INVALID_CURSOR",
    );
  }
  return parsed.offset;
}

/** One page of a list route, as the real server pages it: `limit` rows
 *  after the cursor, and a `nextCursor` (bound to this exact query) while
 *  rows remain. The fixture's own order stands in for the sort order. */
function pageOf(items, params, route, extra = {}) {
  const label = ROUTE_LABELS[route] ?? route;
  const limit = resolveLimit(params, label);
  const fingerprint = fingerprintOf(route, params);
  const after = params.get("after");
  const offset = after === null ? 0 : decodeCursor(after, fingerprint, label);
  const page = items.slice(offset, offset + limit);
  const next = offset + limit;
  return {
    status: "ok",
    command: route,
    ...extra,
    items: page,
    nextCursor: next < items.length ? encodeCursor(fingerprint, next) : null,
    limit,
  };
}

/** Allowed `sort` values per route (and History view) and the default
 *  direction, as core validates them (`finding-query.ts`'s
 *  `resolveSort`). A bad sort or direction is a 400. */
const SORTS = {
  "history:visits": ["visit-time", "url", "duration", "profile"],
  "history:activity": ["local-time", "visit-count", "duration", "profile"],
  "history:most-visited": ["visit-count", "url", "profile"],
  "history:durations": ["duration", "visit-count", "url", "profile"],
  cookies: [
    "host",
    "name",
    "creation-time",
    "expires-time",
    "last-access-time",
    "profile",
  ],
  credentials: [
    "created-time",
    "last-used-time",
    "origin",
    "username",
    "profile",
  ],
  "top-sites": ["rank", "url", "title", "profile"],
  "cache:finding": ["key", "last-used", "size", "entry-hash", "profile"],
  "cache:candidate": ["key", "last-used", "profile"],
  favicons: ["icon-url", "page-url", "last-updated", "width", "profile"],
  candidates: ["rank", "kind", "supporting-count", "value", "profile"],
  "topic-candidates": ["rank", "supporting", "label", "profile"],
  metadata: ["type", "profile"],
  downloads: [
    "start-time",
    "end-time",
    "target-path",
    "state",
    "total-bytes",
    "profile",
  ],
  bookmarks: ["name", "url", "date-added", "folder", "profile"],
  autofill: [
    "created-time",
    "last-used-time",
    "field-name",
    "value",
    "profile",
  ],
};

/** A field's comparable value for the mock's sorts: a timestamp's UTC
 *  instant, an integer string as a number, any other string as itself;
 *  null when the field holds no recorded value (such rows sort last, as
 *  core's keyset order puts them). */
function sortValue(field) {
  if (field === undefined || field.state !== "value") return null;
  const value = field.value;
  if (value !== null && typeof value === "object" && "utc" in value) {
    return value.utc;
  }
  if (typeof value === "string") {
    if (value === "") return null;
    return /^-?\d+$/.test(value) ? Number(value) : value;
  }
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string");
    return first ?? null;
  }
  return typeof value === "number" ? value : null;
}

/** The sort keys the mock honours, per route (and History view): each
 *  maps a `sort` value to the row value it orders by, and names the
 *  route's default sort and direction. Routes not listed keep the
 *  fixture's own order. */
const SORT_KEYS = {
  "history:visits": {
    default: ["visit-time", "desc"],
    keys: {
      "visit-time": (row) => sortValue(row.fields.visitTime),
      url: (row) => sortValue(row.fields.url),
      duration: (row) => sortValue(row.fields.visitDuration),
      profile: (row) => row.profile,
    },
  },
  cookies: {
    default: ["creation-time", "desc"],
    keys: {
      host: (row) => sortValue(row.fields.hostKey),
      name: (row) => sortValue(row.fields.name),
      "creation-time": (row) => sortValue(row.fields.creationTime),
      "expires-time": (row) => sortValue(row.fields.expiresTime),
      "last-access-time": (row) => sortValue(row.fields.lastAccessTime),
      profile: (row) => row.profile,
    },
  },
  credentials: {
    default: ["last-used-time", "desc"],
    keys: {
      "created-time": (row) => sortValue(row.fields.dateCreated),
      "last-used-time": (row) => sortValue(row.fields.dateLastUsed),
      origin: (row) => sortValue(row.fields.originUrl),
      username: (row) => sortValue(row.fields.usernameValue),
      profile: (row) => row.profile,
    },
  },
  favicons: {
    default: ["last-updated", "desc"],
    keys: {
      "icon-url": (row) => sortValue(row.fields.iconUrl),
      "page-url": (row) => sortValue(row.fields.pageUrls),
      "last-updated": (row) => sortValue(row.fields.lastUpdated),
      width: (row) => sortValue(row.fields.width),
      profile: (row) => row.profile,
    },
  },
};

/** Orders rows by the request's `sort` / `direction` as the real server
 *  does for the routes in `SORT_KEYS` (stable: ties keep fixture order;
 *  a row without the value sorts last in either direction). */
function sortedRows(rows, params, key) {
  const spec = SORT_KEYS[key];
  if (spec === undefined) return rows;
  const sort = params.get("sort") ?? spec.default[0];
  const direction = params.get("direction") ?? spec.default[1];
  const read = spec.keys[sort];
  if (read === undefined) return rows;
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: read(row) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        return a.value === b.value
          ? a.index - b.index
          : a.value === null
            ? 1
            : -1;
      }
      const order = a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
      return order === 0 ? a.index - b.index : order * sign;
    })
    .map((entry) => entry.row);
}

function checkSort(params, key, label) {
  const sort = params.get("sort");
  const allowed = SORTS[key];
  if (sort !== null && allowed !== undefined && !allowed.includes(sort)) {
    throw new MockBadRequest(`${label} --sort has an unsupported value.`, {
      value: sort,
      allowed,
    });
  }
  const direction = params.get("direction");
  if (direction !== null && direction !== "asc" && direction !== "desc") {
    throw new MockBadRequest(`${label} --direction has an unsupported value.`, {
      value: direction,
      allowed: ["asc", "desc"],
    });
  }
}

const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/** `from` / `to` as core's `normalizeInstant` accepts them (a full ISO 8601
 *  instant with an offset), normalized to a comparable UTC string. */
function instantParam(params, name, label) {
  const raw = params.get(name);
  if (raw === null || raw === "") {
    return "";
  }
  const parsed = Date.parse(raw);
  if (!INSTANT.test(raw) || Number.isNaN(parsed)) {
    throw new MockBadRequest(
      `${label} --${name} must be an ISO 8601 instant with an offset.`,
      { value: raw },
    );
  }
  const fraction = /\.(\d{1,6})/.exec(raw)?.[1] ?? "";
  const micros = fraction.padEnd(6, "0").slice(3);
  return new Date(parsed).toISOString().replace(/Z$/, `${micros}Z`);
}

/** The Commit States the real server accepts (core's `resolveCommitState`). */
const COMMIT_STATES = ["committed", "wal_resident", "journal_resident"];

/** The `commit-state` filter, as the real server applies it on every Finding
 *  route that accepts it: absent → every row; a known state → only rows in
 *  that state; anything else → 400 INVALID_ARGUMENT. */
function byCommitState(rows, params) {
  const state = params?.get("commit-state");
  if (state === null || state === undefined || state === "") {
    return rows;
  }
  if (!COMMIT_STATES.includes(state)) {
    throw new MockBadRequest("--commit-state has an unsupported value.", {
      value: state,
      allowed: COMMIT_STATES,
    });
  }
  return rows.filter((row) => row.commitState === state);
}

function findingRows(rows) {
  // Strip the fixture's internal `_sort*`/`_host` helper fields before
  // serializing — the wire shape only carries `fields`, not the sort keys
  // the fixture generator used to build `mostVisited`, etc.
  return rows.map(
    ({
      recordType,
      findingKind,
      profile,
      commitState,
      provenance,
      fields,
    }) => ({
      recordType,
      findingKind,
      profile,
      commitState,
      provenance,
      fields,
    }),
  );
}

function candidateRows(rows) {
  return rows.map((row) => ({ ...row }));
}

/* --------------------------------- routes --------------------------------- */

const historyView = (view, request) => {
  const rows =
    view === "activity"
      ? caseData.history.activity
      : view === "most-visited"
        ? caseData.history.mostVisited
        : caseData.history.visits; // "visits" and default
  return findingRows(readable(rows, "History", request));
};

/** Extracts the ISO timestamp a Finding sorts the Timeline by, per
 *  `findingKind` — mirrors core's `queryTimeline` branch selection
 *  (history visits, downloads, cookie creation, autofill last-used). */
const TIMELINE_SORT_FIELD = {
  history_visit: "visitTime",
  download: "startTime",
  cookie: "creationTime",
  autofill_entry: "dateLastUsed",
};

function timelineSortKey(row) {
  const fieldName = TIMELINE_SORT_FIELD[row.findingKind];
  const field = fieldName === undefined ? undefined : row.fields[fieldName];
  return field?.state === "value" ? field.value.utc : null;
}

/** The `from` / `to` instant bounds, as the real server applies them to the
 *  History `visits` view and the Timeline: rows whose time falls outside are
 *  dropped (a row with no time too, once a bound is set). */
function byInstantRange(rows, params, timeOf, label) {
  const from = instantParam(params, "from", label);
  const to = instantParam(params, "to", label);
  if (from !== "" && to !== "" && from > to) {
    throw new MockBadRequest(`${label} --from must not be later than --to.`, {
      from,
      to,
    });
  }
  if (from === "" && to === "") {
    return rows;
  }
  return rows.filter((row) => {
    const utc = timeOf(row);
    return (
      utc !== null && (from === "" || utc >= from) && (to === "" || utc <= to)
    );
  });
}

const visitTimeOf = (row) =>
  row.fields.visitTime?.state === "value"
    ? row.fields.visitTime.value.utc
    : null;

function timelineRows(request) {
  const rows = [
    ...readable(caseData.history.visits, "History", request),
    ...readable(caseData.downloads, "Downloads", request),
    ...readable(caseData.cookies, "Cookies", request),
    ...readable(caseData.autofill, "Web Data", request),
  ].filter((row) => timelineSortKey(row) !== null);
  rows.sort((a, b) => (timelineSortKey(a) < timelineSortKey(b) ? 1 : -1)); // desc, newest first
  return findingRows(rows);
}

/* ------------------------------ sites routes ------------------------------ */

/** `"value"`-state non-empty string field, or null. */
function textField(row, field) {
  const value = row.fields[field];
  return value?.state === "value" &&
    typeof value.value === "string" &&
    value.value !== ""
    ? value.value
    : null;
}

/** Each Sites kind and its fixture rows (less unread databases), in the
 *  order core pages a host's rows. Which fields put a row on a host is
 *  core's own `siteHostsOf` (imported above), never a copy. */
const SITE_SOURCES = [
  [
    "visits",
    (request) => readable(caseData.history.visits, "History", request),
  ],
  ["cookies", (request) => readable(caseData.cookies, "Cookies", request)],
  [
    "saved_logins",
    (request) => readable(caseData.credentials, "Login Data", request),
  ],
  [
    "bookmarks",
    (request) => readable(caseData.bookmarks, "Bookmarks", request),
  ],
  ["top_sites", (request) => readable(caseData.topSites, "Top Sites", request)],
  [
    "downloads",
    (request) => readable(caseData.downloads, "Downloads", request),
  ],
  ["cache", (request) => readable(caseData.cache, "Cache", request)],
  ["favicons", (request) => readable(caseData.favicons, "Favicons", request)],
];

const SITE_KINDS = SITE_SOURCES.map(([kind]) => kind);

/** Rows per kind, every kind at zero (core's `emptyCounts`). */
function emptySiteCounts() {
  return Object.fromEntries(SITE_KINDS.map((kind) => [kind, 0]));
}

function siteHosts(params, request) {
  const search = (params.get("search") ?? "").toLowerCase();
  const byHost = new Map();
  for (const [kind, rowsOf] of SITE_SOURCES) {
    for (const row of rowsOf(request)) {
      // A row on several hosts (a redirect chain, a favicon's page URLs)
      // counts once on each.
      for (const host of siteHostsOf(row.findingKind, row.fields).keys()) {
        const entry = byHost.get(host) ?? {
          counts: emptySiteCounts(),
          savedCounts: emptySiteCounts(),
        };
        entry.counts[kind] += 1;
        if (row.commitState === "committed") entry.savedCounts[kind] += 1;
        byHost.set(host, entry);
      }
    }
  }
  // Host-name order (code units), as core's querySiteHosts pages them.
  const items = [...byHost.entries()]
    .filter(([host]) => search === "" || host.includes(search))
    .map(([host, entry]) => ({ host, ...entry }))
    .sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
  return pageOf(items, params, "site-hosts");
}

/** Most hosts (or hashes) one favicon request may name (core's limit). */
const FAVICON_REQUEST_LIMIT = 100;

/** `site-favicons` as core answers it: per host, the widest *saved* bitmap
 *  on it (ties to the first row) as a `data:` URI, or `null`. */
function siteFavicons(params, request) {
  const hosts = params.getAll("host");
  if (hosts.length > FAVICON_REQUEST_LIMIT) {
    throw new MockBadRequest(
      `Sites favicons take at most ${FAVICON_REQUEST_LIMIT} hosts.`,
      { hosts: hosts.length },
    );
  }
  const best = new Map();
  for (const row of readable(caseData.favicons, "Favicons", request)) {
    if (row.commitState !== "committed" || typeof row._dataUri !== "string") {
      continue;
    }
    const width = Number(textField(row, "width") ?? "-1");
    for (const host of siteHostsOf(row.findingKind, row.fields).keys()) {
      const current = best.get(host);
      if (current === undefined || width > current.width) {
        best.set(host, { width, uri: row._dataUri });
      }
    }
  }
  const icons = {};
  for (const host of hosts) {
    icons[host] = best.get(host.toLocaleLowerCase("en-US"))?.uri ?? null;
  }
  return { status: "ok", command: "site-favicons", icons };
}

/** `favicon-bitmaps` as core answers it: per SHA-256, the stored bitmap of
 *  a favicon row (any Commit State) that records it, or `null`. */
function faviconBitmaps(params, request) {
  const hashes = params.getAll("sha256");
  if (hashes.length > FAVICON_REQUEST_LIMIT) {
    throw new MockBadRequest(
      `Favicon bitmaps take at most ${FAVICON_REQUEST_LIMIT} hashes.`,
      { sha256s: hashes.length },
    );
  }
  const invalid = hashes.find((sha) => !/^[0-9a-f]{64}$/.test(sha));
  if (invalid !== undefined) {
    throw new MockBadRequest(
      "Favicon bitmaps take SHA-256 hashes as 64 lower-case hex digits.",
      { sha256: invalid },
    );
  }
  const bitmaps = Object.fromEntries(hashes.map((sha) => [sha, null]));
  for (const row of readable(caseData.favicons, "Favicons", request)) {
    const sha = textField(row, "payloadSha256");
    if (sha !== null && sha in bitmaps && typeof row._dataUri === "string") {
      bitmaps[sha] ??= row._dataUri;
    }
  }
  return { status: "ok", command: "favicon-bitmaps", bitmaps };
}

/** One host's rows (core's `querySiteFindings`), each with its
 *  `artifactKind` and the fields that record the host (`hostFields`). */
function siteFindings(params, request) {
  if ((params.get("host") ?? "") === "") {
    throw new MockBadRequest("Sites --host must not be empty.");
  }
  const host = siteHostKey(params.get("host"));
  const items = [];
  if (host !== null) {
    for (const [kind, rowsOf] of SITE_SOURCES) {
      for (const row of rowsOf(request)) {
        const hostFields = siteHostsOf(row.findingKind, row.fields).get(host);
        if (hostFields !== undefined) {
          items.push({
            ...findingRows([row])[0],
            artifactKind: kind,
            hostFields,
          });
        }
      }
    }
  }
  return pageOf(items, params, "site-findings");
}

// `commit-state` is honored exactly where server/src/index.ts passes it to
// core: not on `cache` (its records carry their state mixed) or `timeline`
// (one chronological stream), and not on the site-* routes.
/** A Finding route of one Completeness artifact: its readable rows, by
 *  `commit-state`, limited. */
const artifactRoute = (route, rowsOf, artifact) => (params, request) => {
  checkSort(params, route, ROUTE_LABELS[route]);
  return pageOf(
    sortedRows(
      byCommitState(findingRows(readable(rowsOf(), artifact, request)), params),
      params,
      route,
    ),
    params,
    route,
  );
};

const HISTORY_VIEWS = ["visits", "activity", "most-visited", "durations"];

const ROUTES = {
  "site-hosts": (params, request) => siteHosts(params, request),
  "site-findings": (params, request) => siteFindings(params, request),
  completeness: (_params, request) => completenessFor(request),
  profiles: () => caseData.profiles,
  history: (params, request) => {
    const view = params.get("view") ?? "visits";
    if (!HISTORY_VIEWS.includes(view)) {
      throw new MockBadRequest("History --view has an unsupported value.", {
        value: view,
        allowed: HISTORY_VIEWS,
      });
    }
    const sort = params.get("sort");
    if (sort !== null && !SORTS[`history:${view}`].includes(sort)) {
      throw new MockBadRequest(
        `History sort ${sort} is not available for ${view}.`,
        { sort, view },
      );
    }
    checkSort(params, `history:${view}`, "History");
    if (
      view !== "visits" &&
      ["from", "to", "transition"].some((name) => params.get(name) !== null)
    ) {
      throw new MockBadRequest(
        "History --from, --to and --transition apply only to the visits view.",
        { view },
      );
    }
    const rows = historyView(view, request);
    return pageOf(
      byCommitState(
        view === "visits"
          ? sortedRows(
              byInstantRange(rows, params, visitTimeOf, "History"),
              params,
              "history:visits",
            )
          : rows,
        params,
      ),
      params,
      "history",
      { view },
    );
  },
  timeline: (params, request) => {
    checkSort(params, "timeline", "Timeline");
    const stream = timelineRows(request);
    return pageOf(
      byInstantRange(
        params.get("direction") === "asc" ? stream.reverse() : stream,
        params,
        timelineSortKey,
        "Timeline",
      ),
      params,
      "timeline",
    );
  },
  "site-favicons": (params, request) => siteFavicons(params, request),
  "favicon-bitmaps": (params, request) => faviconBitmaps(params, request),
  cookies: artifactRoute("cookies", () => caseData.cookies, "Cookies"),
  credentials: artifactRoute(
    "credentials",
    () => caseData.credentials,
    "Login Data",
  ),
  "top-sites": artifactRoute("top-sites", () => caseData.topSites, "Top Sites"),
  // No commit-state filter on cache (its records carry their state mixed).
  cache: (params, request) => {
    const recordType = params.get("record-type") ?? "finding";
    if (recordType !== "finding" && recordType !== "candidate") {
      throw new MockBadRequest(
        "Cache --record-type has an unsupported value.",
        {
          value: recordType,
        },
      );
    }
    checkSort(params, `cache:${recordType}`, "Cache");
    return pageOf(
      findingRows(readable(caseData.cache, "Cache", request)),
      params,
      "cache",
      { recordType },
    );
  },
  favicons: artifactRoute("favicons", () => caseData.favicons, "Favicons"),
  candidates: (params) => {
    checkSort(params, "candidates", "Candidates");
    return pageOf(candidateRows(caseData.candidates), params, "candidates");
  },
  "topic-candidates": (params) => {
    checkSort(params, "topic-candidates", "Topic Candidate");
    return pageOf(
      byCommitState(candidateRows(caseData.topicCandidates), params),
      params,
      "topic-candidates",
    );
  },
  metadata: artifactRoute("metadata", () => caseData.metadata, "Preferences"),
  downloads: artifactRoute("downloads", () => caseData.downloads, "Downloads"),
  bookmarks: artifactRoute("bookmarks", () => caseData.bookmarks, "Bookmarks"),
  autofill: artifactRoute("autofill", () => caseData.autofill, "Web Data"),
};

/* --------------------------------- server ---------------------------------- */

function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(text);
}

function sendText(response, status, contentType, text) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(text);
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${HOST}`);
  const path = requestUrl.pathname;

  if (path === "/" || path === "/index.html") {
    response.setHeader("content-security-policy", CONTENT_SECURITY_POLICY);
    sendText(response, 200, "text/html; charset=utf-8", htmlShell());
    return;
  }

  if (path === "/index.js") {
    if (!existsSync(distIndexJs)) {
      sendText(
        response,
        500,
        "text/plain; charset=utf-8",
        `${distIndexJs} is missing. Run \`npm run build\` in client/ first.`,
      );
      return;
    }
    // Read fresh on every request so a rebuild is picked up without
    // restarting the mock server.
    const bundle = readFileSync(distIndexJs, "utf8");
    sendText(response, 200, "text/javascript; charset=utf-8", bundle);
    return;
  }

  if (path.startsWith("/api/")) {
    const route = path.slice("/api/".length);
    const handler = ROUTES[route];
    if (handler === undefined) {
      // The real server: an unknown route is INVALID_ARGUMENT (400).
      sendJson(response, 400, {
        status: "error",
        code: "INVALID_ARGUMENT",
        message: "Unknown dashboard route.",
        details: { route },
      });
      return;
    }
    try {
      sendJson(response, 200, handler(requestUrl.searchParams, request));
    } catch (error) {
      if (error instanceof MockBadRequest) {
        sendJson(response, 400, {
          status: "error",
          code: error.code,
          message: error.message,
          details: error.details,
        });
        return;
      }
      sendJson(response, 500, {
        code: "MOCK_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  sendJson(response, 404, {
    code: "NOT_FOUND",
    message: "No such mock resource.",
  });
});

server.listen(port, HOST, () => {
  const url = `http://${HOST}:${port}/`;
  console.log(`[forensix mock] design-only Case "${caseData.caseId}"`);
  console.log(`[forensix mock] ready → ${url}`);
  console.log(`[forensix mock] bundle: ${distIndexJs}`);
  if (!existsSync(distIndexJs)) {
    console.log(
      `[forensix mock] note: ${distIndexJs} not built yet - run \`npm run build\` first.`,
    );
  }
});
