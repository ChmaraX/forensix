import { describe, expect, it } from "vitest";

import {
  ApiError,
  apiFailureMessage,
  classifyApiFailure,
  isAbortError,
} from "./api.js";

describe("classifyApiFailure", () => {
  it("reads no response as an unreachable server", () => {
    expect(classifyApiFailure(null)).toBe("unreachable");
  });

  it("reads 401 / 403 as a refused tab (token, host, origin)", () => {
    expect(classifyApiFailure(401)).toBe("token");
    expect(classifyApiFailure(403)).toBe("token");
  });

  it("reads any other answer as the server's own failure", () => {
    for (const status of [400, 404, 405, 500, 503]) {
      expect(classifyApiFailure(status)).toBe("failed");
    }
  });
});

const UNREACHABLE =
  "The ForensiX server did not answer - it may have stopped. Retry; if it still does not answer, start forensix serve again and open the link it prints.";
const TOKEN =
  "The ForensiX server refused this tab's token - usually because the server was restarted after this tab opened. Open the dashboard again from the link forensix serve printed.";
const FAILED =
  "The ForensiX server could not complete this read. Retry; if it fails again, the server's own words are in brackets.";

describe("apiFailureMessage", () => {
  it("words each kind of failure, keeping the detail in brackets", () => {
    expect(apiFailureMessage("unreachable", "Failed to fetch")).toBe(
      `${UNREACHABLE} (Failed to fetch)`,
    );
    expect(apiFailureMessage("token", "Forbidden")).toBe(
      `${TOKEN} (Forbidden)`,
    );
    expect(
      apiFailureMessage("failed", "The dashboard could not read the Case."),
    ).toBe(`${FAILED} (The dashboard could not read the Case.)`);
  });

  it("adds no empty brackets", () => {
    expect(apiFailureMessage("failed", " ")).toBe(FAILED);
  });
});

describe("ApiError", () => {
  it("carries its kind, detail and status, with the sentence as message", () => {
    const error = new ApiError("unreachable", "Failed to fetch", null);
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe("unreachable");
    expect(error.detail).toBe("Failed to fetch");
    expect(error.status).toBeNull();
    expect(error.message).toBe(`${UNREACHABLE} (Failed to fetch)`);
  });
});

describe("isAbortError", () => {
  it("recognises a cancelled read only", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("Failed to fetch"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
