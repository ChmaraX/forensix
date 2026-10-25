/**
 * How the Browser profile page reads a Metadata row: its one name, the
 * person behind it, the plain-language badges derived from a value it
 * already carries (never a new fact), and the OS-crypt key readings.
 */
import { Badge } from "@/components/ui/badge";

import type { FieldState, Finding } from "../types.js";
import { EvidenceDot } from "./evidence.js";
import { MaybeFieldStateText } from "./field-state.js";
import { fieldBool, fieldString, profileLabel } from "./finding-fields.js";

/* ------------------------- Field readers (never invent) ------------------- */

/** A row's name, the one way the dashboard names it: "Local State" for
 *  the browser-level row, else its profile ("Default profile",
 *  "Profile 2"). */
export function rowHeadline(row: Finding): string {
  return row.findingKind === "browser_metadata"
    ? "Local State"
    : profileLabel(row.profile);
}

/** The person behind a profile row, as recorded: the account's full name,
 *  else Chrome's profile name; null when neither is recorded. */
export function personOf(row: Finding): string | null {
  return (
    fieldString(row.fields.accountFullName) ??
    fieldString(row.fields.profileName)
  );
}

/* ------------------------------ Derived badges ---------------------------- */

/** A derived reading: its words, and — only for a reading that is a warning
 *  — the state its dot repeats. Every other reading is a plain label. */
export interface Reading {
  readonly label: string;
}

/**
 * The last-shutdown reading of a profile, from its `exitType`. Chrome writes
 * "Normal" on a clean quit and "Crashed" / "SessionEnded" otherwise; anything
 * else is shown verbatim rather than guessed at, and an absent value yields no
 * badge at all (the field list still shows the field's own state).
 */
export function exitReading(field: FieldState | undefined): Reading | null {
  const raw = fieldString(field);
  if (raw === null) {
    return null;
  }
  const normalized = raw.toLocaleLowerCase("en-US");
  if (normalized === "normal") {
    return { label: "Clean exit" };
  }
  if (normalized === "crashed") {
    return { label: "Crashed" };
  }
  return { label: `Exit: ${raw}` };
}

/**
 * Whether a profile is a signed-in Google account or a local default profile.
 * A recorded account e-mail is the deciding fact; `isUsingDefaultName === true`
 * with no e-mail is the local case. When neither can be read, no badge is drawn.
 */
export function accountReading(fields: Finding["fields"]): Reading | null {
  if (fieldString(fields.accountEmail) !== null) {
    return { label: "Signed-in account" };
  }
  if (fieldBool(fields.isUsingDefaultName) === true) {
    return { label: "Local profile" };
  }
  return null;
}

/** A derived reading as a plain FF Badge (no evidence hue: an exit type or
 *  an account kind is no evidence state). Not focusable — the card is the
 *  one tab stop, and the field list and the detail sheet carry the source
 *  values. */
export function ReadingBadge({ reading }: { readonly reading: Reading }) {
  return <Badge size="compact">{reading.label}</Badge>;
}

/* ----------------------------- Encryption keys ---------------------------- */

/**
 * The two OS-crypt key-presence booleans Local State records. Each reads as
 * a worded state - a recorded `true` "present", `false` "not present" - in
 * the recorded fields (their one place on the page); an absent or
 * unavailable source field keeps its own word and no yes/no is claimed.
 * What each key protects, and what the pair decides, is the label's
 * tooltip.
 */
export const KEY_FIELDS: Readonly<Record<string, string>> = {
  osCryptKeyPresent: "Protects cookies, saved logins, and autofill values.",
  osCryptAppBoundKeyPresent:
    "Newer, app-scoped key for the most sensitive values.",
};

/** What the recorded key pair means for decryption, from the standard key
 *  first (the app-bound key only matters beside it). */
export function postureOf(fields: Finding["fields"]): string {
  const standard = fieldBool(fields.osCryptKeyPresent);
  const appBound = fieldBool(fields.osCryptAppBoundKeyPresent);
  return standard === true
    ? appBound === true
      ? "Both encryption keys are on disk: the strongest decryption position."
      : "The standard key is on disk; app-bound protected data may not decrypt."
    : standard === false
      ? "No standard key on disk: encrypted values will not decrypt from this evidence."
      : fields.osCryptKeyPresent?.state === "unavailable"
        ? "Key presence could not be read from Local State."
        : fields.osCryptKeyPresent?.state === "value"
          ? "Key presence is recorded, but not as yes or no."
          : "Key presence is not recorded in Local State.";
}

/** A key-presence field as "present" / "not present", else its own word. */
export function KeyPresence({
  field,
}: {
  readonly field: FieldState | undefined;
}) {
  const present = fieldBool(field);
  if (present === null) {
    return <MaybeFieldStateText field={field} />;
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <EvidenceDot state="neutral" />
      {present ? "present" : "not present"}
    </span>
  );
}
