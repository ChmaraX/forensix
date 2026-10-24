import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";

import {
  ForensixError,
  queryAutofill,
  queryBookmarks,
  queryCache,
  queryCandidates,
  queryCompleteness,
  queryCookies,
  queryCredentials,
  queryDownloads,
  queryFavicons,
  queryHistory,
  queryMetadata,
  queryProfiles,
  queryTimeline,
  queryTopSites,
  queryTopicCandidates,
  type AutofillDirection,
  type Finding,
  type ForensicFields,
  type AutofillSort,
  type BookmarkDirection,
  type BookmarkSort,
  type BookmarkSource,
  type CacheDirection,
  type CacheRecordType,
  type CacheSort,
  type CandidateDirection,
  type CandidateSort,
  type CommitState,
  type CookieDirection,
  type CookieSort,
  type CredentialDirection,
  type CredentialSort,
  type DownloadDirection,
  type DownloadSort,
  type FaviconDirection,
  type FaviconSort,
  type HistoryDirection,
  type HistorySort,
  type HistoryView,
  type MetadataDirection,
  type MetadataSort,
  type MetadataType,
  type TimelineDirection,
  type TopSiteDirection,
  type TopSiteSort,
  type TopicCandidateDirection,
  type TopicCandidateSort,
} from "@forensix/core";

/**
 * Read-only loopback dashboard adapter.
 *
 * The server is a thin adapter over the analyzer core. It contains no forensic
 * logic and performs no Case writes: every route maps request parameters onto a
 * core read query that opens the Case immutable and read-only. There is no
 * ingest, analyse, or export route, so the dashboard can neither start nor
 * rerun any pipeline.
 *
 * Security posture:
 *  - binds only to 127.0.0.1 (there is no host-exposure option);
 *  - mints one per-run bearer token that every /api request must present;
 *  - rejects any request whose Origin header is not a loopback origin.
 *
 * Tracked as implementation issue #171.
 */

export interface StartDashboardServerOptions {
  readonly caseDirectory: string;
  /** TCP port. 0 (default) asks the OS for an ephemeral loopback port. */
  readonly port?: number;
}

export interface DashboardServer {
  readonly url: string;
  readonly token: string;
  readonly port: number;
  readonly host: "127.0.0.1";
  close(): Promise<void>;
}

const LOOPBACK_HOST = "127.0.0.1" as const;
const TOKEN_HEADER = "x-forensix-token";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
// Fetch Metadata values that prove a request was not initiated cross-site.
const SAME_ORIGIN_FETCH_SITES = new Set(["same-origin", "none"]);

const require = createRequire(import.meta.url);

function loadClientBundle(): string {
  return readFileSync(require.resolve("@forensix/client"), "utf8");
}

function htmlShell(token: string): string {
  const safeToken = JSON.stringify(token);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>ForensiX read-only Case dashboard</title>
    <script>window.__FORENSIX_TOKEN__ = ${safeToken};</script>
    <script type="module" src="/index.js"></script>
  </head>
  <body>
    <!--
      Design: Fluid Functionalism (fluidfunctionalism.com) - neutral surface
      ladder, Inter (bundled), six type roles, spring motion. Hues mean
      evidence state only (produced, unavailable, WAL, journal) and always
      sit beside their word; saved and recovered rows are separate lists.
      Read-only. Guide: client/FLUID.md.
    -->
    <noscript>This read-only dashboard needs JavaScript to render Case lists.</noscript>
    <div id="app">Loading read-only Case dashboard…</div>
  </body>
</html>
`;
}

function headerValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : (value as string | undefined);
}

/**
 * The host authority (without port) the request was addressed to. It is the
 * anchor for the loopback Host allowlist that defeats DNS-rebinding.
 */
function hostAuthority(hostHeader: string | undefined): string | null {
  if (hostHeader === undefined || hostHeader.length === 0) {
    return null;
  }
  if (hostHeader.startsWith("[")) {
    const end = hostHeader.indexOf("]");
    return end === -1 ? null : hostHeader.slice(0, end + 1);
  }
  const colon = hostHeader.lastIndexOf(":");
  return colon === -1 ? hostHeader : hostHeader.slice(0, colon);
}

/**
 * Reject any Host header that does not name a loopback authority. A rebinding
 * attacker's page carries its own hostname in Host even though it resolves to
 * 127.0.0.1, so this closes that vector regardless of the socket binding.
 */
function isLoopbackHost(hostHeader: string | undefined): boolean {
  const authority = hostAuthority(hostHeader);
  return authority !== null && LOOPBACK_HOSTNAMES.has(authority);
}

/**
 * Whether an /api request is proven to originate from the loopback dashboard
 * itself. An Origin, when present, must be loopback. When Origin is absent the
 * request must carry Fetch Metadata proving it was not initiated cross-site;
 * an absent Origin with no such proof is rejected.
 */
function isSameOriginApiRequest(request: IncomingMessage): boolean {
  const origin = headerValue(request.headers.origin);
  if (origin !== undefined && origin !== "null") {
    try {
      return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname);
    } catch {
      return false;
    }
  }
  const fetchSite = headerValue(request.headers["sec-fetch-site"]);
  return fetchSite !== undefined && SAME_ORIGIN_FETCH_SITES.has(fetchSite);
}

function tokensMatch(expected: string, provided: string | undefined): boolean {
  if (provided === undefined) {
    return false;
  }
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, providedBytes);
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function statusForError(error: ForensixError): number {
  switch (error.code) {
    case "INVALID_ARGUMENT":
    case "INVALID_CURSOR":
      return 400;
    case "ANALYSIS_NOT_FOUND":
      return 404;
    default:
      return 409;
  }
}

function firstString(value: string | null): string | undefined {
  return value ?? undefined;
}

function findingFieldString(
  fields: ForensicFields,
  key: string,
): string | null {
  const field = fields[key];
  return field !== undefined &&
    field.state === "value" &&
    typeof field.value === "string"
    ? field.value
    : null;
}

function findingFieldStringArray(
  fields: ForensicFields,
  key: string,
): readonly string[] {
  const field = fields[key];
  if (field === undefined || field.state !== "value" || !Array.isArray(field.value)) {
    return [];
  }
  return field.value.filter(
    (entry): entry is string => typeof entry === "string",
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Sniffs the image container from its leading bytes. The recovered favicon
 * payload carries no format field of its own — Chrome writes
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
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 3 && bytes.toString("ascii", 0, 3) === "GIF") {
    return "image/gif";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    bytes[3] === 0x00
  ) {
    return "image/x-icon";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return "image/png";
}

/**
 * Best-effort favicon lookup for a set of hosts, read straight from the
 * Case's own recovered `favicon_bitmaps` payloads and returned as inline
 * `data:` URIs — the dashboard's CSP (`img-src data:`) admits no other image
 * source, so this is the only way a recovered icon can render at all; it is
 * never fetched live. "Best" is the largest recovered bitmap whose page URLs
 * or icon URL resolve to that host. A host with no recovered favicon maps to
 * `null`, the dashboard's cue to fall back to its own letter tile — the
 * absence is real, not a loading state.
 *
 * Reads one page of favicons (the route's own cap, 100 rows) rather than
 * paginating the whole table: enough for every dashboard caller today (a
 * handful of Overview or Sites-tab hosts at a time). A Case with more than
 * 100 recovered favicons can miss one for a requested host; that host then
 * falls back to its letter tile exactly as if none had been recovered,
 * never a wrong or stale icon.
 */
function resolveFaviconDataUris(
  caseDirectory: string,
  hosts: readonly string[],
): Record<string, string | null> {
  const wanted = new Set(hosts);
  const best = new Map<string, { width: number; path: string }>();
  const page = queryFavicons({ caseDirectory, limit: 100 });
  for (const finding of page.items as readonly Finding[]) {
    const payloadPath = findingFieldString(finding.fields, "payloadPath");
    if (payloadPath === null) {
      continue;
    }
    const width = Number(findingFieldString(finding.fields, "width") ?? "0");
    const candidates = new Set<string>();
    for (const url of findingFieldStringArray(finding.fields, "pageUrls")) {
      const host = hostOf(url);
      if (host !== null) {
        candidates.add(host);
      }
    }
    const iconUrl = findingFieldString(finding.fields, "iconUrl");
    if (iconUrl !== null) {
      const host = hostOf(iconUrl);
      if (host !== null) {
        candidates.add(host);
      }
    }
    for (const host of candidates) {
      if (!wanted.has(host)) {
        continue;
      }
      const current = best.get(host);
      if (current === undefined || width > current.width) {
        best.set(host, { width, path: payloadPath });
      }
    }
  }
  const result: Record<string, string | null> = {};
  for (const host of hosts) {
    const record = best.get(host);
    if (record === undefined) {
      result[host] = null;
      continue;
    }
    try {
      const bytes = readFileSync(join(caseDirectory, record.path));
      result[host] =
        `data:${sniffImageMimeType(bytes)};base64,${bytes.toString("base64")}`;
    } catch {
      result[host] = null;
    }
  }
  return result;
}

function integerParameter(
  parameters: URLSearchParams,
  name: string,
): number | undefined {
  const value = parameters.get(name);
  if (value === null) {
    return undefined;
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Query parameter ${name} must be an integer.`,
      { parameter: name, value },
    );
  }
  return Number(value);
}

/**
 * The paginated fields every artifact list route shares. Each route spreads
 * this and adds only its own filters; the sort/direction unions are supplied by
 * the caller so the per-route query keeps its exact input type. Sort and
 * direction stay pass-through strings here — the analyzer core validates them
 * with the same wording the CLI relies on, so the HTTP layer adds no divergent
 * error path.
 */
function listParameters<Sort extends string, Direction extends string>(
  parameters: URLSearchParams,
): {
  readonly profiles: string[];
  readonly search: string | undefined;
  readonly sort: Sort | undefined;
  readonly direction: Direction | undefined;
  readonly limit: number | undefined;
  readonly after: string | undefined;
} {
  return {
    profiles: parameters.getAll("profile"),
    search: firstString(parameters.get("search")),
    sort: firstString(parameters.get("sort")) as Sort | undefined,
    direction: firstString(parameters.get("direction")) as
      | Direction
      | undefined,
    limit: integerParameter(parameters, "limit"),
    after: firstString(parameters.get("after")),
  };
}

/**
 * Declarative dashboard route table. Each entry maps request parameters onto a
 * single read-only core query; {@link handleApi} owns the dispatch and the
 * unknown-route error so the routes cannot drift in shape.
 */
export const API_ROUTES = new Map<
  string,
  (parameters: URLSearchParams, caseDirectory: string) => unknown
>([
  [
    "completeness",
    (_parameters, caseDirectory) => queryCompleteness({ caseDirectory }),
  ],
  [
    "profiles",
    (_parameters, caseDirectory) => queryProfiles({ caseDirectory }),
  ],
  [
    "history",
    (parameters, caseDirectory) =>
      queryHistory({
        caseDirectory,
        ...listParameters<HistorySort, HistoryDirection>(parameters),
        view: firstString(parameters.get("view")) as HistoryView | undefined,
        commitState: firstString(parameters.get("commit-state")) as
          | CommitState
          | undefined,
        transition: firstString(parameters.get("transition")),
        from: firstString(parameters.get("from")),
        to: firstString(parameters.get("to")),
      }),
  ],
  [
    "timeline",
    (parameters, caseDirectory) =>
      queryTimeline({
        caseDirectory,
        limit: integerParameter(parameters, "limit"),
        after: firstString(parameters.get("after")),
        from: firstString(parameters.get("from")),
        to: firstString(parameters.get("to")),
        direction: firstString(parameters.get("direction")) as
          | TimelineDirection
          | undefined,
      }),
  ],
  // "site-hosts" and "site-findings" are not wired up here yet: the client's
  // Sites page will show its normal "could not be loaded" state — an honest
  // gap, not a crash — until that backend work lands.
  [
    "site-favicons",
    (parameters, caseDirectory) => ({
      status: "ok",
      icons: resolveFaviconDataUris(caseDirectory, parameters.getAll("host")),
    }),
  ],
  [
    "cookies",
    (parameters, caseDirectory) =>
      queryCookies({
        caseDirectory,
        ...listParameters<CookieSort, CookieDirection>(parameters),
        commitState: firstString(parameters.get("commit-state")) as
          | CommitState
          | undefined,
        host: firstString(parameters.get("host")),
        sameSite: firstString(parameters.get("same-site")),
      }),
  ],
  [
    "credentials",
    (parameters, caseDirectory) =>
      queryCredentials({
        caseDirectory,
        ...listParameters<CredentialSort, CredentialDirection>(parameters),
        commitState: firstString(parameters.get("commit-state")) as
          | CommitState
          | undefined,
      }),
  ],
  [
    "top-sites",
    (parameters, caseDirectory) =>
      queryTopSites({
        caseDirectory,
        ...listParameters<TopSiteSort, TopSiteDirection>(parameters),
        commitState: firstString(parameters.get("commit-state")) as
          | CommitState
          | undefined,
      }),
  ],
  [
    "cache",
    (parameters, caseDirectory) =>
      queryCache({
        caseDirectory,
        ...listParameters<CacheSort, CacheDirection>(parameters),
        recordType: firstString(parameters.get("record-type")) as
          | CacheRecordType
          | undefined,
        backend: firstString(parameters.get("backend")),
      }),
  ],
  [
    "favicons",
    (parameters, caseDirectory) =>
      queryFavicons({
        caseDirectory,
        ...listParameters<FaviconSort, FaviconDirection>(parameters),
        commitState: firstString(parameters.get("commit-state")) as
          | CommitState
          | undefined,
      }),
  ],
  [
    "candidates",
    (parameters, caseDirectory) =>
      queryCandidates({
        caseDirectory,
        ...listParameters<CandidateSort, CandidateDirection>(parameters),
        category: firstString(parameters.get("category")),
        kind: firstString(parameters.get("kind")),
      }),
  ],
  [
    "topic-candidates",
    (parameters, caseDirectory) =>
      queryTopicCandidates({
        caseDirectory,
        ...listParameters<TopicCandidateSort, TopicCandidateDirection>(
          parameters,
        ),
        commitState: firstString(parameters.get("commit-state")) as
          | CommitState
          | undefined,
        label: firstString(parameters.get("label")),
      }),
  ],
  [
    "metadata",
    (parameters, caseDirectory) =>
      queryMetadata({
        caseDirectory,
        ...listParameters<MetadataSort, MetadataDirection>(parameters),
        commitState: firstString(parameters.get("commit-state")) as
          | CommitState
          | undefined,
        type: firstString(parameters.get("type")) as MetadataType | undefined,
      }),
  ],
  [
    "downloads",
    (parameters, caseDirectory) =>
      queryDownloads({
        caseDirectory,
        ...listParameters<DownloadSort, DownloadDirection>(parameters),
        commitState: firstString(parameters.get("commit-state")) as
          | CommitState
          | undefined,
        state: firstString(parameters.get("state")),
        dangerType: firstString(parameters.get("danger-type")),
      }),
  ],
  [
    "bookmarks",
    (parameters, caseDirectory) =>
      queryBookmarks({
        caseDirectory,
        ...listParameters<BookmarkSort, BookmarkDirection>(parameters),
        commitState: firstString(parameters.get("commit-state")) as
          | CommitState
          | undefined,
        source: firstString(parameters.get("source")) as
          | BookmarkSource
          | undefined,
      }),
  ],
  [
    "autofill",
    (parameters, caseDirectory) =>
      queryAutofill({
        caseDirectory,
        ...listParameters<AutofillSort, AutofillDirection>(parameters),
        commitState: firstString(parameters.get("commit-state")) as
          | CommitState
          | undefined,
      }),
  ],
]);

function handleApi(
  route: string,
  parameters: URLSearchParams,
  caseDirectory: string,
): unknown {
  const handler = API_ROUTES.get(route);
  if (handler === undefined) {
    throw new ForensixError("INVALID_ARGUMENT", "Unknown dashboard route.", {
      route,
    });
  }
  return handler(parameters, caseDirectory);
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  caseDirectory: string,
  clientBundle: string,
): void {
  // Loopback Host allowlist first: defeats DNS-rebinding before any work.
  if (!isLoopbackHost(headerValue(request.headers.host))) {
    sendJson(response, 403, {
      code: "FORBIDDEN_HOST",
      message: "The dashboard answers loopback hosts only.",
    });
    return;
  }
  // The dashboard is strictly read-only: only GET is ever answered.
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, {
      code: "METHOD_NOT_ALLOWED",
      message: "The read-only dashboard answers GET requests only.",
    });
    return;
  }

  const requestUrl = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);
  const path = requestUrl.pathname;

  if (path === "/" || path === "/index.html") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      // `img-src data:` admits only bytes already inlined in the bundle, which
      // is how the brand mark ships. It grants no origin, so the surface still
      // cannot fetch an image — or anything else — off this machine.
      // `font-src data:` is the same rule for the one typeface: Inter is
      // embedded in the bundle's stylesheet as a data: URI, never fetched.
      "content-security-policy":
        "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'self'",
    });
    response.end(htmlShell(token));
    return;
  }
  if (path === "/index.js") {
    sendText(response, 200, "text/javascript; charset=utf-8", clientBundle);
    return;
  }

  if (path.startsWith("/api/")) {
    // The per-run token is accepted from the request header only; it is never
    // read from the URL, so it cannot leak through logs or referrers.
    if (!tokensMatch(token, headerValue(request.headers[TOKEN_HEADER]))) {
      sendJson(response, 401, {
        code: "UNAUTHORIZED",
        message: "A valid per-run dashboard token is required.",
      });
      return;
    }
    if (!isSameOriginApiRequest(request)) {
      sendJson(response, 403, {
        code: "FORBIDDEN_ORIGIN",
        message: "The dashboard accepts same-origin loopback requests only.",
      });
      return;
    }
    const route = path.slice("/api/".length);
    try {
      sendJson(
        response,
        200,
        handleApi(route, requestUrl.searchParams, caseDirectory),
      );
    } catch (error) {
      if (error instanceof ForensixError) {
        sendJson(response, statusForError(error), error.toDiagnostic());
        return;
      }
      sendJson(response, 500, {
        code: "DASHBOARD_ERROR",
        message: "The dashboard could not read the Case.",
      });
    }
    return;
  }

  sendJson(response, 404, {
    code: "NOT_FOUND",
    message: "No such dashboard resource.",
  });
}

/**
 * Start the read-only dashboard server on a loopback port.
 *
 * It mints one per-run bearer token and loads the client bundle up front, so a
 * missing build fails before the socket binds. It binds 127.0.0.1 only; there
 * is no host option. Every API route opens the Case read-only.
 *
 * Returns a `DashboardServer` with the URL, the per-run token, the bound port,
 * the loopback host, and a `close()` handle.
 */
export async function startDashboardServer(
  options: StartDashboardServerOptions,
): Promise<DashboardServer> {
  const token = randomBytes(32).toString("base64url");
  // Load the client bundle up front so a missing build fails before binding.
  const clientBundle = loadClientBundle();
  const server: Server = createServer((request, response) => {
    handleRequest(
      request,
      response,
      token,
      options.caseDirectory,
      clientBundle,
    );
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    // Bind loopback only. There is deliberately no host option.
    server.listen(options.port ?? 0, LOOPBACK_HOST, () => {
      server.removeListener("error", rejectPromise);
      resolvePromise();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("The dashboard could not bind a loopback port.");
  }
  const port = address.port;
  const url = `http://${LOOPBACK_HOST}:${port}/`;

  return {
    url,
    token,
    port,
    host: LOOPBACK_HOST,
    close(): Promise<void> {
      return new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      });
    },
  };
}
