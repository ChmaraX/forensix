import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  isSecretFieldName,
  redactFields,
  type FieldState,
} from "../src/index.js";

function sha256(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

describe("Extract redaction primitive", () => {
  it("classifies plaintext-secret field names case-insensitively", () => {
    expect(isSecretFieldName("password_value")).toBe(true);
    expect(isSecretFieldName("Encrypted_Value")).toBe(true);
    expect(isSecretFieldName("cookie_value")).toBe(true);
    expect(isSecretFieldName("token")).toBe(true);
    // A Cookie Finding's plaintext (or decrypted) secret lives in the field
    // named exactly `value`; it is a secret by exact match.
    expect(isSecretFieldName("value")).toBe(true);
    expect(isSecretFieldName("url")).toBe(false);
    expect(isSecretFieldName("visitTime")).toBe(false);
    // The exact `value` rule must not over-match metadata fields.
    expect(isSecretFieldName("encryptedValueByteLength")).toBe(false);
    expect(isSecretFieldName("encryptedValueScheme")).toBe(false);
  });

  it("withholds a Cookie value (plaintext or decrypted) unless opted in", () => {
    const fields: Readonly<Record<string, FieldState<unknown>>> = {
      value: { state: "value", value: "session-token" },
      encryptedValueByteLength: { state: "value", value: "48" },
    };
    const redacted = redactFields(fields, false);
    expect(redacted.redactedCount).toBe(1);
    expect(redacted.fields.value).toEqual({
      state: "redacted",
      reason: "plaintext_secret_withheld",
      sha256: sha256(JSON.stringify("session-token")),
    });
    // Retained metadata is not a secret and stays disclosed.
    expect(redacted.fields.encryptedValueByteLength).toBe(
      fields.encryptedValueByteLength,
    );
    // With the explicit opt-in the value is disclosed.
    expect(redactFields(fields, true).fields.value).toEqual({
      state: "value",
      value: "session-token",
    });
  });

  it("withholds secret values by default while keeping them citable by hash", () => {
    const fields: Readonly<Record<string, FieldState<unknown>>> = {
      password_value: { state: "value", value: "hunter2" },
      url: { state: "value", value: "https://example.test/" },
      missing: { state: "absent" },
    };
    const redacted = redactFields(fields, false);
    expect(redacted.redactedCount).toBe(1);
    expect(redacted.fields.password_value).toEqual({
      state: "redacted",
      reason: "plaintext_secret_withheld",
      sha256: sha256(JSON.stringify("hunter2")),
    });
    // Non-secret Field State is preserved unchanged.
    expect(redacted.fields.url).toBe(fields.url);
    expect(redacted.fields.missing).toBe(fields.missing);
  });

  it("discloses secret values when explicitly opted in", () => {
    const fields: Readonly<Record<string, FieldState<unknown>>> = {
      password_value: { state: "value", value: "hunter2" },
    };
    const disclosed = redactFields(fields, true);
    expect(disclosed.redactedCount).toBe(0);
    expect(disclosed.fields.password_value).toEqual({
      state: "value",
      value: "hunter2",
    });
  });

  it("does not redact secret-named fields that are already absent or unavailable", () => {
    const fields: Readonly<Record<string, FieldState<unknown>>> = {
      token: { state: "unavailable", reason: "missing_column" },
      secret_note: { state: "absent" },
    };
    const redacted = redactFields(fields, false);
    expect(redacted.redactedCount).toBe(0);
    expect(redacted.fields.token).toEqual({
      state: "unavailable",
      reason: "missing_column",
    });
    expect(redacted.fields.secret_note).toEqual({ state: "absent" });
  });
});
