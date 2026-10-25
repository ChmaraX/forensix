import { describe, expect, it } from "vitest";

import { humanizeFieldValue, humanizeToken } from "./field-values.js";

describe("humanizeToken", () => {
  it("spells an enum token in sentence case", () => {
    expect(humanizeToken("not_dangerous")).toBe("Not dangerous");
    expect(humanizeToken("interrupted")).toBe("Interrupted");
    expect(humanizeToken("in_progress")).toBe("In progress");
    expect(humanizeToken("network_failed")).toBe("Network failed");
  });

  it("keeps acronyms in capitals", () => {
    expect(humanizeToken("dangerous_url")).toBe("Dangerous URL");
    expect(humanizeToken("http")).toBe("HTTP");
  });

  it("reads the few tokens that say something else", () => {
    expect(humanizeToken("no_restriction")).toBe("No restriction (None)");
    expect(humanizeToken("user_canceled")).toBe("Cancelled by the user");
  });
});

describe("humanizeFieldValue", () => {
  it("humanizes a decoded enum, keeping the recorded token as a caption", () => {
    expect(
      humanizeFieldValue("dangerType", "download", "not_dangerous"),
    ).toEqual({ text: "Not dangerous", caption: "not_dangerous" });
    expect(humanizeFieldValue("state", "download", "interrupted")).toEqual({
      text: "Interrupted",
      caption: "interrupted",
    });
    expect(humanizeFieldValue("sameSite", "cookie", "lax")).toEqual({
      text: "Lax",
      caption: "lax",
    });
  });

  it("leaves a general name alone outside its kind", () => {
    expect(humanizeFieldValue("state", "cookie", "interrupted")).toBeNull();
  });

  it("never humanizes a value that is data, not a token", () => {
    // A cookie's own name, a URL, a free-text title.
    expect(humanizeFieldValue("name", "cookie", "session_id")).toBeNull();
    expect(
      humanizeFieldValue("url", "history_visit", "https://a.b/"),
    ).toBeNull();
    expect(
      humanizeFieldValue("dangerType", "download", "Not A Token"),
    ).toBeNull();
  });

  it("reads booleans as Yes / No with the recorded value as a caption", () => {
    expect(humanizeFieldValue("opened", "download", false)).toEqual({
      text: "No",
      caption: "false",
    });
    expect(humanizeFieldValue("isSecure", "cookie", true)).toEqual({
      text: "Yes",
      caption: "true",
    });
  });

  it("formats byte counts exactly, with the short size and the raw on hover", () => {
    expect(humanizeFieldValue("receivedBytes", "download", 9873300)).toEqual({
      text: "9,873,300 bytes (9.4 MB)",
      title: "9873300",
    });
    expect(humanizeFieldValue("totalBytes", "download", "512")).toEqual({
      text: "512 bytes",
      title: "512",
    });
    expect(humanizeFieldValue("entrySizeBytes", "cache_entry", 1)).toEqual({
      text: "1 byte",
      title: "1",
    });
  });

  it("leaves a byte field alone when it is not a whole count", () => {
    expect(humanizeFieldValue("receivedBytes", "download", -1)).toBeNull();
    expect(humanizeFieldValue("receivedBytes", "download", "12kb")).toBeNull();
  });

  it("does not format a password length as a byte size", () => {
    expect(
      humanizeFieldValue("secretByteLength", "saved_login", 4096),
    ).toBeNull();
  });
});
