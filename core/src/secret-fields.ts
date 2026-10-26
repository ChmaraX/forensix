/**
 * The explicit secret table: for each record kind, the fields that hold a
 * decrypted or plaintext secret. Only these fields are redacted. A field is
 * added here only when the analyzer can write a plaintext secret to it:
 *
 *  - `cookie.value`: the Cookie value, plaintext in the store or decrypted
 *    with `--decrypt`;
 *  - `login_credential.secret`: the saved password, decrypted with
 *    `--decrypt`.
 *
 * Deliberately import-free and Node-free: the dashboard bundle imports this
 * same file, so the dashboard masks exactly the fields core redacts.
 */
export const SECRET_FIELDS_BY_KIND: Readonly<
  Record<string, readonly string[]>
> = {
  cookie: ["value"],
  login_credential: ["secret"],
};

/** True when `field` of a `kind` record holds a plaintext secret. */
export function isSecretField(kind: string, field: string): boolean {
  return SECRET_FIELDS_BY_KIND[kind]?.includes(field) ?? false;
}
