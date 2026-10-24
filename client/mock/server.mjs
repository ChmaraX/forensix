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
 * Simplification (see mock/README.md): `limit` and `commit-state` are honored
 * (commit-state on exactly the routes the real server filters by it); every
 * other query param (search, sort, direction, per-artifact extra filters;
 * `from` / `to` are honored on the History visits view and the timeline) is
 * accepted but IGNORED. That is enough to design against; it is not enough to
 * test filtering/sorting/pagination behavior.
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

/** Every list route: `{status:"ok", items, nextCursor:null, limit}`. Sort,
 *  direction, and per-artifact extra filters are intentionally not applied —
 *  see the module doc comment. `limit` IS honored: the Overview page relies
 *  on it to keep fixed-height side-by-side cards (Recent downloads, Top
 *  sites, most-visited) from overflowing and blowing out the CSS grid row
 *  they share, which drags every sibling card in that row to match. */
function pageOf(items, params) {
  const requested = Number(params?.get("limit"));
  const limit =
    Number.isInteger(requested) && requested > 0
      ? Math.min(requested, items.length)
      : items.length;
  return {
    status: "ok",
    items: items.slice(0, limit),
    nextCursor: null,
    limit,
  };
}

/** The Commit States the real server accepts (core's `resolveCommitState`). */
const COMMIT_STATES = ["committed", "wal_resident", "journal_resident"];

class MockBadRequest extends Error {}

/** The `commit-state` filter, as the real server applies it on every Finding
 *  route that accepts it: absent → every row; a known state → only rows in
 *  that state; anything else → 400 INVALID_ARGUMENT. */
function byCommitState(rows, params) {
  const state = params?.get("commit-state");
  if (state === null || state === undefined || state === "") {
    return rows;
  }
  if (!COMMIT_STATES.includes(state)) {
    throw new MockBadRequest(
      `--commit-state must be one of ${COMMIT_STATES.join(", ")}.`,
    );
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
function byInstantRange(rows, params, timeOf) {
  const from = params?.get("from") ?? "";
  const to = params?.get("to") ?? "";
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

/** `"value"`-state string field, or null. */
function textField(row, field) {
  const value = row.fields[field];
  return value?.state === "value" &&
    typeof value.value === "string" &&
    value.value !== ""
    ? value.value
    : null;
}

/** Normalized host key: URL host or cookie host key, lowercased, without
 *  leading dots or `www.` — so `.gmail.com` cookies and `www.gmail.com`
 *  visits group under one host, mirroring what the future real route will
 *  do. */
function hostKeyOf(raw) {
  if (raw === null) return null;
  let host = raw;
  if (host.includes("://")) {
    try {
      host = new URL(host).host;
    } catch {
      return null;
    }
  }
  host = host
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/^www\./, "");
  return host === "" ? null : host;
}

/** Each site artifact kind: its fixture rows (less unread databases) and
 *  the field carrying a host. */
const SITE_SOURCES = [
  [
    "visits",
    (request) => readable(caseData.history.visits, "History", request),
    (row) => textField(row, "url"),
  ],
  [
    "cookies",
    (request) => readable(caseData.cookies, "Cookies", request),
    (row) => textField(row, "hostKey"),
  ],
  [
    "saved_logins",
    (request) => readable(caseData.credentials, "Login Data", request),
    (row) => textField(row, "originUrl") ?? textField(row, "signonRealm"),
  ],
  [
    "bookmarks",
    (request) => readable(caseData.bookmarks, "Bookmarks", request),
    (row) => textField(row, "url"),
  ],
  [
    "top_sites",
    (request) => readable(caseData.topSites, "Top Sites", request),
    (row) => textField(row, "url"),
  ],
];

const EMPTY_SITE_COUNTS = {
  visits: 0,
  cookies: 0,
  saved_logins: 0,
  bookmarks: 0,
  top_sites: 0,
  form_data: 0,
};

function siteHosts(params, request) {
  const search = (params.get("search") ?? "").toLowerCase();
  const byHost = new Map();
  for (const [kind, rowsOf, hostOf] of SITE_SOURCES) {
    for (const row of rowsOf(request)) {
      const host = hostKeyOf(hostOf(row));
      if (host === null) continue;
      const counts = byHost.get(host) ?? { ...EMPTY_SITE_COUNTS };
      counts[kind] += 1;
      byHost.set(host, counts);
    }
  }
  const items = [...byHost.entries()]
    .filter(([host]) => search === "" || host.includes(search))
    .map(([host, counts]) => ({ host, counts }))
    .sort(
      (a, b) =>
        Object.values(b.counts).reduce((s, n) => s + n, 0) -
        Object.values(a.counts).reduce((s, n) => s + n, 0),
    );
  return { status: "ok", items, nextCursor: null, limit: items.length };
}

function siteFindings(params, request) {
  const host = hostKeyOf(params.get("host"));
  const items = [];
  if (host !== null) {
    for (const [kind, rowsOf, hostOf] of SITE_SOURCES) {
      for (const row of rowsOf(request)) {
        if (hostKeyOf(hostOf(row)) === host) {
          items.push({ ...findingRows([row])[0], artifactKind: kind });
        }
      }
    }
  }
  return { status: "ok", items, nextCursor: null, limit: items.length || 1 };
}

// `commit-state` is honored exactly where server/src/index.ts passes it to
// core: not on `cache` (its records carry their state mixed) or `timeline`
// (one chronological stream), and not on the site-* routes.
/** A Finding route of one Completeness artifact: its readable rows, by
 *  `commit-state`, limited. */
const artifactRoute = (rowsOf, artifact) => (params, request) =>
  pageOf(
    byCommitState(findingRows(readable(rowsOf(), artifact, request)), params),
    params,
  );

const ROUTES = {
  "site-hosts": (params, request) => siteHosts(params, request),
  "site-findings": (params, request) => siteFindings(params, request),
  completeness: (_params, request) => completenessFor(request),
  profiles: () => caseData.profiles,
  history: (params, request) => {
    const view = params.get("view");
    const rows = historyView(view, request);
    return pageOf(
      byCommitState(
        view === "activity" || view === "most-visited"
          ? rows
          : byInstantRange(rows, params, visitTimeOf),
        params,
      ),
      params,
    );
  },
  timeline: (params, request) =>
    pageOf(
      byInstantRange(timelineRows(request), params, timelineSortKey),
      params,
    ),
  "site-favicons": () => ({ status: "ok", icons: {} }),
  cookies: artifactRoute(() => caseData.cookies, "Cookies"),
  credentials: artifactRoute(() => caseData.credentials, "Login Data"),
  "top-sites": artifactRoute(() => caseData.topSites, "Top Sites"),
  // No commit-state filter on cache (its records carry their state mixed).
  cache: (params, request) =>
    pageOf(findingRows(readable(caseData.cache, "Cache", request)), params),
  favicons: artifactRoute(() => caseData.favicons, "Favicons"),
  candidates: (params) => pageOf(candidateRows(caseData.candidates), params),
  "topic-candidates": (params) =>
    pageOf(
      byCommitState(candidateRows(caseData.topicCandidates), params),
      params,
    ),
  metadata: artifactRoute(() => caseData.metadata, "Preferences"),
  downloads: artifactRoute(() => caseData.downloads, "Downloads"),
  bookmarks: artifactRoute(() => caseData.bookmarks, "Bookmarks"),
  autofill: artifactRoute(() => caseData.autofill, "Web Data"),
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
      sendJson(response, 404, {
        code: "NOT_FOUND",
        message: "No such dashboard route in the design mock.",
      });
      return;
    }
    try {
      sendJson(response, 200, handler(requestUrl.searchParams, request));
    } catch (error) {
      if (error instanceof MockBadRequest) {
        sendJson(response, 400, {
          code: "INVALID_ARGUMENT",
          message: error.message,
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
