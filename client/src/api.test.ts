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

describe("apiFailureMessage", () => {
  it("words each kind of failure differently, keeping the detail", () => {
    const detail = "Failed to fetch";
    const messages = (["unreachable", "token", "failed"] as const).map((kind) =>
      apiFailureMessage(kind, detail),
    );
    expect(new Set(messages).size).toBe(3);
    for (const message of messages) {
      expect(message.endsWith(`(${detail})`)).toBe(true);
    }
  });

  it("keeps the server's own words for any other failure", () => {
    expect(
      apiFailureMessage("failed", "The dashboard could not read the Case."),
    ).toContain("(The dashboard could not read the Case.)");
  });

  it("adds no empty brackets", () => {
    expect(apiFailureMessage("failed", " ")).not.toContain("()");
  });
});

describe("ApiError", () => {
  it("carries its kind, detail and status, with the sentence as message", () => {
    const error = new ApiError("unreachable", "Failed to fetch", null);
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe("unreachable");
    expect(error.detail).toBe("Failed to fetch");
    expect(error.status).toBeNull();
    expect(error.message).toBe(
      apiFailureMessage("unreachable", "Failed to fetch"),
    );
  });
});

describe("isAbortError", () => {
  it("recognises a cancelled read only", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("Failed to fetch"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
