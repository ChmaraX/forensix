/**
 * Which fields of a row hold a secret, for the row sheet (`RowSheet` masks
 * them itself) and table cells. Pure (no React), so the rule is unit-tested
 * on its own (`secrets.test.ts`).
 *
 * - the fields core redacts (`SECRET_FIELDS_BY_KIND`, core/src/secret-fields.ts,
 *   import- and Node-free, so the bundle includes it as is): a cookie's
 *   `value`, a saved login's `secret`;
 * - a Form data entry's `fieldValue` / `fieldValueLower` when its field
 *   name is Payment, or when no usable name was recorded (fail closed).
 *
 * Every other row has none.
 */
import { SECRET_FIELDS_BY_KIND } from "../../../core/src/secret-fields.js";
import type { Finding } from "../types.js";
import { isSecretFormField, PAYMENT_SECRET_FIELDS } from "./form-data.js";

/** The unavailable reason that means "encrypted, and no key material was
 *  given": the one state the pages word as "sealed". Any other reason (a
 *  failed decryption, an unsupported value) shows as itself. */
export const SEALED_REASON = "encrypted_secret_without_key_material";

export function secretFieldsOf(row: Finding): readonly string[] {
  if (row.findingKind === "autofill_entry") {
    return isSecretFormField(row.fields.fieldName) ? PAYMENT_SECRET_FIELDS : [];
  }
  return SECRET_FIELDS_BY_KIND[row.findingKind] ?? [];
}
