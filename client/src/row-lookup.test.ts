import { describe, expect, it } from "vitest";

import { refFilterOf } from "./row-lookup.js";

describe("refFilterOf", () => {
  it("reads the profile and Commit State a row reference names", () => {
    expect(
      refFilterOf("Profile 3/History|visits|10901|Profile 3|committed"),
    ).toEqual({ profile: "Profile 3", commitState: "committed" });
    expect(refFilterOf("|cookies|7|Default|wal_resident")).toEqual({
      profile: "Default",
      commitState: "wal_resident",
    });
  });

  it("reads nothing from a malformed reference", () => {
    expect(refFilterOf("visits|10901")).toBeNull();
    expect(refFilterOf("a|b|c|d|")).toBeNull();
  });
});
