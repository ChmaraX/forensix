import {
  absentField,
  unavailableField,
  valueField,
  type FieldState,
  type FieldUnavailableReason,
} from "./forensic-model.js";
import { decryptOscryptValue, type DecryptionSettings } from "./oscrypt.js";

/**
 * The Field States a single encrypted secret resolves to. The parser maps
 * `value` onto its own field name (a Cookie `value` or a credential `secret`)
 * and carries the decryption route and citing key-material record alongside it.
 */
export interface DecryptedSecretField {
  readonly value: FieldState<string>;
  readonly route: FieldState<string>;
  readonly keyMaterialRecordId: FieldState<string>;
}

/**
 * A store-specific check on decrypted plaintext bytes. It returns the secret
 * bytes to keep (for example, with a verified binding prefix removed), or a
 * typed reason when the plaintext fails the check. It never guesses.
 */
export type PlaintextUnwrap = (
  plaintext: Uint8Array,
) =>
  | { readonly ok: true; readonly plaintext: Uint8Array }
  | { readonly ok: false; readonly reason: FieldUnavailableReason };

/**
 * Resolve one encrypted secret blob strictly within the opt-in gate. This is
 * the single decryption seam shared by the Cookies and Login Data parsers, so
 * the gate behaves identically for both:
 *
 * - Decryption disabled (the default): the secret stays `unavailable` with the
 *   historic `encrypted_secret_without_key_material` reason and no key material
 *   is ever consulted.
 * - Enabled: the blob is dispatched offline by its own prefix. Success yields
 *   the plaintext plus the citing route and key-material record; every failure
 *   keeps a distinct typed reason.
 * - `unwrap`, when given, checks the decrypted bytes before they become a
 *   `value`; a failed check keeps the secret `unavailable` with its reason.
 */
export function decryptSecretField(
  ciphertext: Uint8Array,
  profile: string,
  decryption: DecryptionSettings,
  unwrap?: PlaintextUnwrap,
): DecryptedSecretField {
  if (!decryption.enabled) {
    return {
      value: unavailableField("encrypted_secret_without_key_material"),
      route: absentField(),
      keyMaterialRecordId: absentField(),
    };
  }
  const outcome = decryptOscryptValue({
    ciphertext,
    profile,
    keyMaterial: decryption.keyMaterial,
  });
  if (outcome.state === "unavailable") {
    return {
      value: unavailableField(outcome.reason),
      route: absentField(),
      keyMaterialRecordId: absentField(),
    };
  }
  const checked =
    unwrap === undefined
      ? { ok: true as const, plaintext: outcome.plaintext }
      : unwrap(outcome.plaintext);
  if (!checked.ok) {
    return {
      value: unavailableField(checked.reason),
      route: absentField(),
      keyMaterialRecordId: absentField(),
    };
  }
  return {
    value: valueField(Buffer.from(checked.plaintext).toString("utf8")),
    route: valueField(outcome.route),
    keyMaterialRecordId: valueField(outcome.provenance.recordId),
  };
}
