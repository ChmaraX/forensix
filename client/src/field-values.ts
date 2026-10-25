/**
 * Field values in words for the row sheet (pure; unit-tested in
 * field-values.test.ts), the counterpart of `fieldLabel` for values:
 *
 *  - an enum the analyzer decoded from a fixed table (a download's
 *    outcome, danger type and interrupt reason; a cookie's SameSite,
 *    priority, source scheme and type; a visit's source; a favicon's icon
 *    type) reads as a sentence-case word ("Not dangerous"), with the
 *    recorded value kept as a caption (`not_dangerous`);
 *  - a boolean reads "Yes" / "No", the recorded `true` / `false` as a
 *    caption;
 *  - a byte count reads "9,873,300 bytes (9.4 MB)", the recorded number on
 *    hover.
 *
 * Presentation only: the copied or cited value is never altered, and a
 * value outside these rules is shown as recorded (returns null).
 */
import { formatBytes } from "./components/bytes.js";

/** Fields whose value is a token decoded from a fixed enum table. Keyed
 *  `kind:name` where the name is too general to key alone (`state`). */
const ENUM_FIELDS: ReadonlySet<string> = new Set([
  "download:state",
  "dangerType",
  "interruptReason",
  "sameSite",
  "priority",
  "sourceScheme",
  "sourceType",
  "visitSource",
  "iconType",
]);

/** Fields that count bytes (not the password length, which is a length). */
const BYTE_FIELDS: ReadonlySet<string> = new Set([
  "receivedBytes",
  "totalBytes",
  "entrySizeBytes",
  "stream0Size",
  "stream1Size",
  "payloadBytes",
]);

/** Words an enum token spells in capitals or differently. */
const TOKEN_WORDS: Readonly<Record<string, string>> = {
  url: "URL",
  http: "HTTP",
  https: "HTTPS",
  ui: "UI",
};

/** A whole token read differently from its words. */
const TOKEN_OVERRIDES: Readonly<Record<string, string>> = {
  // Chrome's "SameSite=None".
  no_restriction: "No restriction (None)",
  // Chrome spells it both ways across fields.
  canceled: "Cancelled",
  user_canceled: "Cancelled by the user",
};

/** A shape the analyzer's enum tokens have: lower-case words and digits
 *  joined by underscores. */
const TOKEN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** "not_dangerous" → "Not dangerous"; "dangerous_url" → "Dangerous URL". */
export function humanizeToken(token: string): string {
  const override = TOKEN_OVERRIDES[token];
  if (override !== undefined) {
    return override;
  }
  const words = token
    .split("_")
    .filter((word) => word !== "")
    .map((word) => TOKEN_WORDS[word] ?? word);
  const [first = "", ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/** A field value in words. `caption` is the recorded value to show under
 *  it (mono); `title` the recorded value for hover only. */
export interface HumanValue {
  readonly text: string;
  readonly caption?: string;
  readonly title?: string;
}

function isEnumField(name: string, kind: string): boolean {
  return ENUM_FIELDS.has(`${kind}:${name}`) || ENUM_FIELDS.has(name);
}

/** A whole non-negative byte count, from a number or a digit string. */
function byteCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * The words for a recorded value of field `name` on a row of `kind`, or
 * null when the value is shown as recorded.
 */
export function humanizeFieldValue(
  name: string,
  kind: string,
  value: unknown,
): HumanValue | null {
  if (typeof value === "boolean") {
    return { text: value ? "Yes" : "No", caption: String(value) };
  }
  if (BYTE_FIELDS.has(name)) {
    const bytes = byteCount(value);
    if (bytes === null) {
      return null;
    }
    const exact = `${bytes.toLocaleString("en-US")} ${bytes === 1 ? "byte" : "bytes"}`;
    return {
      text: bytes < 1024 ? exact : `${exact} (${formatBytes(bytes)})`,
      title: String(value),
    };
  }
  if (
    isEnumField(name, kind) &&
    typeof value === "string" &&
    TOKEN.test(value)
  ) {
    return { text: humanizeToken(value), caption: value };
  }
  return null;
}
