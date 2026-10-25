/** Read-only loopback API client. GET only; the token rides a header. */

declare global {
  interface Window {
    __FORENSIX_TOKEN__?: string;
  }
}

/** The session token the server wrote into the page, read at call time
 *  (so a module that imports this one also loads outside a browser, as
 *  the unit tests do). */
function token(): string {
  return (globalThis as { window?: Window }).window?.__FORENSIX_TOKEN__ ?? "";
}

export type QueryParameters = readonly (readonly [string, string])[];

/**
 * Why a read failed, in three kinds a person can act on:
 *  - `unreachable`: no answer at all (the server stopped, the network
 *    dropped) - the browser's own words ("Failed to fetch") are the detail;
 *  - `token`: the server answered but refused this tab (its per-run token
 *    is not the server's any more - the server was restarted - or the
 *    host / origin check failed);
 *  - `failed`: the server answered with an error of its own.
 */
export type ApiFailureKind = "unreachable" | "token" | "failed";

/** A failed read. `message` is the sentence to show (it ends with the raw
 *  `detail` in brackets); `detail` is the browser's or server's own words. */
export class ApiError extends Error {
  readonly kind: ApiFailureKind;
  readonly detail: string;
  readonly status: number | null;

  constructor(kind: ApiFailureKind, detail: string, status: number | null) {
    super(apiFailureMessage(kind, detail));
    this.name = "ApiError";
    this.kind = kind;
    this.detail = detail;
    this.status = status;
  }
}

/** The kind of a failed read: no response (`status` null) is unreachable;
 *  401 / 403 (the token, host and origin checks) are a refused tab; any
 *  other answer is the server's own failure. */
export function classifyApiFailure(status: number | null): ApiFailureKind {
  if (status === null) {
    return "unreachable";
  }
  return status === 401 || status === 403 ? "token" : "failed";
}

/** The sentence for a failed read: what happened, what to do, and the raw
 *  detail last so nothing the browser or server said is lost. */
export function apiFailureMessage(
  kind: ApiFailureKind,
  detail: string,
): string {
  const said = detail.trim() === "" ? "" : ` (${detail.trim()})`;
  switch (kind) {
    case "unreachable":
      return `The ForensiX server did not answer - it may have stopped. Retry; if it still does not answer, start forensix serve again and open the link it prints.${said}`;
    case "token":
      return `The ForensiX server refused this tab's token - usually because the server was restarted after this tab opened. Open the dashboard again from the link forensix serve printed.${said}`;
    case "failed":
      return `The ForensiX server could not complete this read. Retry; if it fails again, the server's own words are in brackets.${said}`;
  }
}

/** Whether `error` is a cancelled read (an aborted `signal`), which callers
 *  drop silently. */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: unknown }).name === "AbortError"
  );
}

export async function callApi<T>(
  route: string,
  parameters: QueryParameters,
  options: { readonly signal?: AbortSignal } = {},
): Promise<T> {
  const query = new URLSearchParams();
  for (const [name, value] of parameters) {
    if (value.length > 0) {
      query.append(name, value);
    }
  }
  let response: Response;
  try {
    response = await fetch(`/api/${route}?${query.toString()}`, {
      method: "GET",
      cache: "no-store",
      headers: { "x-forensix-token": token() },
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new ApiError(
      "unreachable",
      error instanceof Error ? error.message : String(error),
      null,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new ApiError(
      response.ok ? "failed" : classifyApiFailure(response.status),
      `Response ${String(response.status)} was not JSON`,
      response.status,
    );
  }
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : `Request failed (${String(response.status)})`;
    throw new ApiError(
      classifyApiFailure(response.status),
      message,
      response.status,
    );
  }
  return body as T;
}
