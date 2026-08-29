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
 * Simplification (see mock/README.md): query params (search, sort, direction,
 * limit, per-artifact extra filters, commit-state) are accepted but IGNORED —
 * every route returns its full static fixture list. That is enough to design
 * against; it is not enough to test filtering/sorting/pagination behavior.
 *
 * Usage:
 *   node mock/server.mjs [--port 7799]
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { caseData } from "./case-data.mjs";

const mockRoot = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(mockRoot, "..");
const distIndexJs = join(clientRoot, "dist", "index.js");

const HOST = "127.0.0.1";
const MOCK_TOKEN = "mock-token-design-only";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const port = Number(option("port", "7799"));

/* ------------------------------- HTML shell ------------------------------- */

function htmlShell() {
  const safeToken = JSON.stringify(MOCK_TOKEN);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ForensiX dashboard — design mock (${caseData.caseId})</title>
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
  return { status: "ok", items: items.slice(0, limit), nextCursor: null, limit };
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
    }) => ({ recordType, findingKind, profile, commitState, provenance, fields }),
  );
}

function candidateRows(rows) {
  return rows.map((row) => ({ ...row }));
}

/* --------------------------------- routes --------------------------------- */

const historyView = (view) => {
  if (view === "activity") return findingRows(caseData.history.activity);
  if (view === "most-visited") return findingRows(caseData.history.mostVisited);
  return findingRows(caseData.history.visits); // "visits" and default
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

function timelineRows() {
  const rows = [
    ...caseData.history.visits,
    ...caseData.downloads,
    ...caseData.cookies,
    ...caseData.autofill,
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
  host = host.toLowerCase().replace(/^\.+/, "").replace(/^www\./, "");
  return host === "" ? null : host;
}

/** Each site artifact kind: its fixture rows and the field carrying a host. */
const SITE_SOURCES = [
  ["visits", () => caseData.history.visits, (row) => textField(row, "url")],
  ["cookies", () => caseData.cookies, (row) => textField(row, "hostKey")],
  [
    "saved_logins",
    () => caseData.credentials,
    (row) => textField(row, "originUrl") ?? textField(row, "signonRealm"),
  ],
  ["bookmarks", () => caseData.bookmarks, (row) => textField(row, "url")],
  ["top_sites", () => caseData.topSites, (row) => textField(row, "url")],
];

const EMPTY_SITE_COUNTS = {
  visits: 0,
  cookies: 0,
  saved_logins: 0,
  bookmarks: 0,
  top_sites: 0,
  form_data: 0,
};

function siteHosts(params) {
  const search = (params.get("search") ?? "").toLowerCase();
  const byHost = new Map();
  for (const [kind, rowsOf, hostOf] of SITE_SOURCES) {
    for (const row of rowsOf()) {
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

function siteFindings(params) {
  const host = hostKeyOf(params.get("host"));
  const items = [];
  if (host !== null) {
    for (const [kind, rowsOf, hostOf] of SITE_SOURCES) {
      for (const row of rowsOf()) {
        if (hostKeyOf(hostOf(row)) === host) {
          items.push({ ...findingRows([row])[0], artifactKind: kind });
        }
      }
    }
  }
  return { status: "ok", items, nextCursor: null, limit: items.length || 1 };
}

const ROUTES = {
  "site-hosts": (params) => siteHosts(params),
  "site-findings": (params) => siteFindings(params),
  completeness: () => caseData.completeness,
  profiles: () => caseData.profiles,
  history: (params) => pageOf(historyView(params.get("view")), params),
  timeline: (params) => pageOf(timelineRows(), params),
  "site-favicons": () => ({ status: "ok", icons: {} }),
  cookies: (params) => pageOf(findingRows(caseData.cookies), params),
  credentials: (params) => pageOf(findingRows(caseData.credentials), params),
  "top-sites": (params) => pageOf(findingRows(caseData.topSites), params),
  cache: (params) => pageOf(findingRows(caseData.cache), params),
  favicons: (params) => pageOf(findingRows(caseData.favicons), params),
  candidates: (params) => pageOf(candidateRows(caseData.candidates), params),
  "topic-candidates": (params) =>
    pageOf(candidateRows(caseData.topicCandidates), params),
  metadata: (params) => pageOf(findingRows(caseData.metadata), params),
  downloads: (params) => pageOf(findingRows(caseData.downloads), params),
  bookmarks: (params) => pageOf(findingRows(caseData.bookmarks), params),
  autofill: (params) => pageOf(findingRows(caseData.autofill), params),
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
    sendText(response, 200, "text/html; charset=utf-8", htmlShell());
    return;
  }

  if (path === "/index.js") {
    if (!existsSync(distIndexJs)) {
      sendText(
        response,
        500,
        "text/plain; charset=utf-8",
        "client/dist/index.js is missing. Run `npm run build` in client/ first.",
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
      sendJson(response, 200, handler(requestUrl.searchParams));
    } catch (error) {
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
  if (!existsSync(distIndexJs)) {
    console.log(
      "[forensix mock] note: client/dist/index.js not built yet — run `npm run build` first.",
    );
  }
});
