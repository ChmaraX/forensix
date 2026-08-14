import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";

import {
  ForensixError,
  queryCompleteness,
  queryCookies,
  queryCredentials,
  queryHistory,
  queryProfiles,
  type CommitState,
  type CookieDirection,
  type CookieSort,
  type CredentialDirection,
  type CredentialSort,
  type HistoryDirection,
  type HistorySort,
  type HistoryView,
} from "@forensix/core";

/**
 * Read-only loopback dashboard adapter (issue #171).
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
 */

export const SERVER_IMPLEMENTATION_ISSUE = 171;

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

function handleApi(
  route: string,
  parameters: URLSearchParams,
  caseDirectory: string,
): unknown {
  const profiles = parameters.getAll("profile");
  const commitState = firstString(parameters.get("commit-state")) as
    | CommitState
    | undefined;
  switch (route) {
    case "completeness":
      return queryCompleteness({ caseDirectory });
    case "profiles":
      return queryProfiles({ caseDirectory });
    case "history":
      return queryHistory({
        caseDirectory,
        view: firstString(parameters.get("view")) as HistoryView | undefined,
        profiles,
        search: firstString(parameters.get("search")),
        commitState,
        transition: firstString(parameters.get("transition")),
        from: firstString(parameters.get("from")),
        to: firstString(parameters.get("to")),
        sort: firstString(parameters.get("sort")) as HistorySort | undefined,
        direction: firstString(parameters.get("direction")) as
          | HistoryDirection
          | undefined,
        limit: integerParameter(parameters, "limit"),
        after: firstString(parameters.get("after")),
      });
    case "cookies":
      return queryCookies({
        caseDirectory,
        profiles,
        search: firstString(parameters.get("search")),
        commitState,
        host: firstString(parameters.get("host")),
        sameSite: firstString(parameters.get("same-site")),
        sort: firstString(parameters.get("sort")) as CookieSort | undefined,
        direction: firstString(parameters.get("direction")) as
          | CookieDirection
          | undefined,
        limit: integerParameter(parameters, "limit"),
        after: firstString(parameters.get("after")),
      });
    case "credentials":
      return queryCredentials({
        caseDirectory,
        profiles,
        search: firstString(parameters.get("search")),
        commitState,
        sort: firstString(parameters.get("sort")) as CredentialSort | undefined,
        direction: firstString(parameters.get("direction")) as
          | CredentialDirection
          | undefined,
        limit: integerParameter(parameters, "limit"),
        after: firstString(parameters.get("after")),
      });
    default:
      throw new ForensixError("INVALID_ARGUMENT", "Unknown dashboard route.", {
        route,
      });
  }
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
      "content-security-policy":
        "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
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
