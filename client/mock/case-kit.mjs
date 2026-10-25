/**
 * The design mock Case's shared fixture kit: the Case's identity and
 * profiles, the FieldState builders (core's shapes: `value`, `absent`,
 * `unavailable`, `timestamp` as a `ForensicTimestamp`) and the seeded random
 * helpers. The scenario (people, sites, story) is in scenario.mjs.
 * Design-only, like case-data.mjs.
 */

export const CASE_ID = "CASE-2024-0416";

export const PROFILE_DEFAULT = "Default";
export const PROFILE_SECOND = "Profile 1";
export const PROFILES = [PROFILE_DEFAULT, PROFILE_SECOND];

export const SOURCE_IMAGE = "src-01-disk-image";
export const SOURCE_USER_DATA = "src-02-user-data-dir";

/* --------------------------- FieldState helpers -------------------------- */

export function value(v, opts) {
  return opts?.synthetic === true
    ? { state: "value", value: v, synthetic: true }
    : { state: "value", value: v };
}

export function absent() {
  return { state: "absent" };
}

export function unavailable(reason) {
  return { state: "unavailable", reason };
}

export const UNAVAILABLE_REASONS = [
  "column not present in this Chrome version",
  "value could not be decrypted offline",
  "row deleted, recovered from WAL without this field",
  "value present but not a recognized encoding",
  "related row missing from this database",
];

/** The reason core gives an encrypted value analysed without the OS key
 *  material (the dashboard words it "sealed"). */
export const SEALED_REASON = "encrypted_secret_without_key_material";

export function reasonFor(seed) {
  return UNAVAILABLE_REASONS[seed % UNAVAILABLE_REASONS.length];
}

/** Deterministic pseudo-random in [0, 1) so fixture generation is stable. */
export function prng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export function pick(rand, list) {
  return list[Math.floor(rand() * list.length) % list.length];
}

/** The mock Case's declared timezone (`analyse --timezone`): every
 *  timestamp and activity row declares it, as core writes them. */
export const DECLARED_TIMEZONE = "UTC";

/** A Chrome (1601-epoch microseconds) timestamp as core's
 *  `ForensicTimestamp`: the raw value, its epoch family, the UTC instant,
 *  the declared timezone and the resolution. */
export function timestamp(isoUtc) {
  return value({
    raw: String((new Date(isoUtc).getTime() + 11_644_473_600_000) * 1000),
    epochFamily: "1601-us",
    utc: isoUtc,
    declaredTimezone: DECLARED_TIMEZONE,
    resolution: "verified_schema_version_42",
  });
}

export function isoAt(daysAgo, hour, minute) {
  const base = new Date("2024-04-17T12:00:00.000Z");
  base.setUTCDate(base.getUTCDate() - daysAgo);
  base.setUTCHours(hour, minute, Math.floor(Math.random() * 60), 0);
  return base.toISOString();
}

/** Deterministic ISO timestamp derived from a seed, not Math.random. */
export function isoAtSeeded(rand, daysAgo, hour, minute) {
  const base = new Date("2024-04-17T12:00:00.000Z");
  base.setUTCDate(base.getUTCDate() - daysAgo);
  const jitterMinute = Math.floor(rand() * 60);
  base.setUTCHours(hour, minute + jitterMinute, Math.floor(rand() * 60), 0);
  return base.toISOString();
}

export function provenance(table, rowId, sourceId = SOURCE_USER_DATA, extra) {
  return {
    manifestPath: `${sourceId}/manifest.jsonl`,
    table,
    rowId: String(rowId),
    ...extra,
  };
}
