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

export async function callApi<T>(
  route: string,
  parameters: QueryParameters,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [name, value] of parameters) {
    if (value.length > 0) {
      query.append(name, value);
    }
  }
  const response = await fetch(`/api/${route}?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: { "x-forensix-token": token() },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : `Request failed (${String(response.status)})`;
    throw new Error(message);
  }
  return body as T;
}
