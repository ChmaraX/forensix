/**
 * Which fields of a row hold a secret, for `RowSheet redactedFields` and
 * table cells. Pure (no React), so the rule is unit-tested on its own
 * (`secrets.test.ts`).
 *
 * - a cookie's `value` (a session secret);
 * - a saved login's `secret` (the password, in clear only after
 *   `--decrypt`);
 * - a Form data entry's `fieldValue` / `fieldValueLower` when its field
 *   name is Payment, or when no usable name was recorded (fail closed).
 *
 * Every other row has none.
 */
import type { Finding } from "../types.js";
import { isSecretFormField, PAYMENT_SECRET_FIELDS } from "./form-data.js";

/** The unavailable reason that means "encrypted, and no key material was
 *  given": the one state the pages word as "sealed". Any other reason (a
 *  failed decryption, an unsupported value) shows as itself. */
export const SEALED_REASON = "encrypted_secret_without_key_material";

/** Fields that hold a cookie's session secret. */
export const COOKIE_SECRET_FIELDS: readonly string[] = ["value"];

/** Fields that hold a saved login's password. */
export const CREDENTIAL_SECRET_FIELDS: readonly string[] = ["secret"];

export function secretFieldsOf(row: Finding): readonly string[] {
  switch (row.findingKind) {
    case "cookie":
      return COOKIE_SECRET_FIELDS;
    case "login_credential":
      return CREDENTIAL_SECRET_FIELDS;
    case "autofill_entry":
      return isSecretFormField(row.fields.fieldName)
        ? PAYMENT_SECRET_FIELDS
        : [];
    default:
      return [];
  }
}
