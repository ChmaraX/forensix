/**
 * The Browser profile page.
 *
 * Metadata is not a stream of events, so this page does not draw a timeline.
 * It reads the two things the Metadata artifact actually carries and frames
 * each as what an examiner asks of it:
 *
 *  - the one browser-level Finding (Local State) — the environment: which
 *    Chrome, which locale region, how many profiles, and whether the machine
 *    can still decrypt its own secrets — read as an environment banner;
 *  - one profile-level Finding per Profile (Preferences + info_cache) — the
 *    account behind each profile — read as a roster of identity cards, each
 *    carrying two derived, plain-language chips: how the profile last shut
 *    down (clean exit vs crash) and whether it is a signed-in account or a
 *    default local profile;
 *  - the encryption posture the whole Case inherits, read straight off the
 *    two OS-crypt key-presence booleans and stated in the terms that decide
 *    whether encrypted evidence can be read at all.
 *
 * Every derived chip is a reading of a value the row already carries, never a
 * new fact: an absent or unavailable source field collapses its chip to the
 * same worded state the table shows, so a conclusion is never asserted past
 * the evidence. The raw table below keeps every field, byte for byte, and the
 * detail sheet keeps every wire field and its provenance.
 *
 * Presentation rules kept: the Completeness Statement renders before any row;
 * value / (empty) / absent / unavailable stay distinct words, never color
 * alone; nothing here is inference presented as a factual summary tile.
 */
import {
  AlertTriangle,
  Chrome,
  CircleCheck,
  Globe2,
  KeyRound,
  Lock,
  Search,
  ShieldCheck,
  Unlock,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { callApi } from "../api.js";
import { cn } from "../lib.js";
import type {
  ArtifactConfig,
  FieldState,
  Finding,
  PageOf,
} from "../types.js";
import { EmptyRows } from "./data-table.js";
import { MaybeFieldStateText } from "./field-state.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { Button } from "./compat/button.js";
import { Skeleton } from "./ui/misc.js";

/** One type-sorted read across every Metadata row, paginated by the route. */
function useMetadata(route: string) {
  const [rows, setRows] = useState<readonly Finding[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    setCursor(null);
    callApi<PageOf<Finding>>(route, [
      ["sort", "type"],
      ["direction", "asc"],
    ])
      .then((page) => {
        if (cancelled) {
          return;
        }
        setRows(page.items);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [route, nonce]);

  const loadMore = useCallback(() => {
    if (cursor === null) {
      return;
    }
    setLoading(true);
    callApi<PageOf<Finding>>(route, [
      ["sort", "type"],
      ["direction", "asc"],
      ["after", cursor],
    ])
      .then((page) => {
        setRows((existing) => [...existing, ...page.items]);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
        setLoading(false);
      });
  }, [route, cursor]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { rows, cursor, loading, error, loadMore, retry };
}

/* ------------------------- Field readers (never invent) ------------------- */

/** A `"value"`-state string, or null — the sole basis for any derived reading. */
function fieldString(field: FieldState | undefined): string | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  if (typeof field.value === "string") {
    return field.value === "" ? null : field.value;
  }
  if (typeof field.value === "number") {
    return String(field.value);
  }
  return null;
}

/** A `"value"`-state boolean, or null — booleans arrive as real `true`/`false`. */
function fieldBool(field: FieldState | undefined): boolean | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  return typeof field.value === "boolean" ? field.value : null;
}

/** Integer carried as a value field, or null. */
function fieldInt(field: FieldState | undefined): number | null {
  const text = fieldString(field);
  if (text === null) {
    return null;
  }
  const value = Number(text);
  return Number.isInteger(value) ? value : null;
}

/** A stable, human label for a profile directory key (`.` is the sole profile). */
function profileLabel(profile: string): string {
  return profile === "." ? "Default profile" : profile;
}

/* -------------------------------- Chips ----------------------------------- */

type ChipTone = "neutral" | "good" | "warn" | "info";

const CHIP_TONE: Readonly<Record<ChipTone, string>> = {
  neutral: "border-border bg-muted text-muted-foreground",
  good: "border-success-border bg-success-wash text-success",
  warn: "border-warning-border bg-warning-wash text-warning",
  info: "border-accent-border bg-accent text-accent-foreground",
};

/**
 * A small worded status chip. The word always carries the meaning; the icon
 * and tone only reinforce it — never the reverse — so the state survives a
 * grayscale print of the report.
 */
function Chip({
  icon: Icon,
  label,
  tone = "neutral",
  title,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly tone?: ChipTone;
  readonly title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium whitespace-nowrap",
        CHIP_TONE[tone],
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
}

/**
 * The last-shutdown reading of a profile, from its `exitType`. Chrome writes
 * "Normal" on a clean quit and "Crashed" / "SessionEnded" otherwise; anything
 * else is shown verbatim rather than guessed at, and an absent value yields no
 * chip at all (the raw table still shows the field's own state).
 */
function exitChip(field: FieldState | undefined): {
  label: string;
  tone: ChipTone;
  icon: LucideIcon;
  title: string;
} | null {
  const raw = fieldString(field);
  if (raw === null) {
    return null;
  }
  const normalized = raw.toLocaleLowerCase("en-US");
  if (normalized === "normal") {
    return {
      label: "Clean exit",
      tone: "good",
      icon: CircleCheck,
      title: `exit_type recorded as "${raw}"`,
    };
  }
  if (normalized === "crashed") {
    return {
      label: "Crashed",
      tone: "warn",
      icon: AlertTriangle,
      title: `exit_type recorded as "${raw}" — the profile did not shut down cleanly`,
    };
  }
  return {
    label: raw,
    tone: "neutral",
    icon: AlertTriangle,
    title: `exit_type recorded as "${raw}"`,
  };
}

/**
 * Whether a profile is a signed-in Google account or a local default profile.
 * A recorded account e-mail is the deciding fact; `isUsingDefaultName === true`
 * with no e-mail is the local case. When neither can be read, no chip is drawn.
 */
function accountChip(fields: Finding["fields"]): {
  label: string;
  tone: ChipTone;
  icon: LucideIcon;
  title: string;
} | null {
  const email = fieldString(fields.accountEmail);
  if (email !== null) {
    return {
      label: "Signed-in account",
      tone: "info",
      icon: UserRound,
      title: `account e-mail on record: ${email}`,
    };
  }
  const defaultName = fieldBool(fields.isUsingDefaultName);
  if (defaultName === true) {
    return {
      label: "Local profile",
      tone: "neutral",
      icon: UserRound,
      title: "no account e-mail recorded; profile is using its default name",
    };
  }
  return null;
}

/* --------------------------- Environment banner --------------------------- */

/** One labelled reading in the environment banner. */
function EnvFact({
  icon: Icon,
  label,
  field,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly field: FieldState | undefined;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/12 ring-1 ring-white/15">
        <Icon aria-hidden="true" className="size-4 text-white" />
      </span>
      <div className="min-w-0">
        <dt className="text-[10.5px] leading-none font-semibold tracking-[0.09em] text-blue-200 uppercase">
          {label}
        </dt>
        <dd className="mt-1.5 [&_span]:!text-white/90">
          <MaybeFieldStateText field={field} truncate />
        </dd>
      </div>
    </div>
  );
}

/**
 * The environment banner — the browser-level Metadata Finding, framed as the
 * machine context every profile below sits inside. It reuses the Overview's
 * one saturated brand-blue panel treatment so the two pages read as one world,
 * and it is the only place metadata gets a hero: the profiles are the detail,
 * the environment is the frame.
 */
function EnvironmentBanner({ browser }: { readonly browser: Finding | null }) {
  const chromeVersion =
    browser === null ? null : fieldString(browser.fields.chromeVersion);
  return (
    <section
      aria-label="Browser environment"
      className="fx-hero relative overflow-hidden rounded-2xl text-white"
    >
      <Chrome
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -bottom-12 size-52 rotate-12 text-white/[0.07]"
      />
      <div className="relative flex flex-col gap-6 px-6 py-6 md:px-8">
        <div className="flex items-center gap-3.5">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/20">
            <Chrome aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[20px] leading-tight font-bold tracking-[-0.02em]">
              {chromeVersion === null
                ? "Chrome browser"
                : `Chrome ${chromeVersion}`}
            </h2>
            <p className="mt-0.5 text-[12.5px] font-medium text-blue-100">
              Environment recorded in Local State
            </p>
          </div>
        </div>
        {browser === null ? (
          <p className="max-w-[52ch] text-[13px] text-blue-100 italic">
            No browser-level metadata was recovered for this Case.
          </p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            <EnvFact
              icon={Users}
              label="Profiles on device"
              field={browser.fields.profileCount}
            />
            <EnvFact
              icon={UserRound}
              label="Last used profile"
              field={browser.fields.lastUsedProfile}
            />
            <EnvFact
              icon={Globe2}
              label="Variations region"
              field={browser.fields.variationsCountry}
            />
            <EnvFact
              icon={Chrome}
              label="Chrome version"
              field={browser.fields.chromeVersion}
            />
          </dl>
        )}
      </div>
    </section>
  );
}

/* ------------------------- Encryption posture strip ----------------------- */

/**
 * One key-presence reading. A recorded `true` means the key material is on
 * disk (evidence can be decrypted with the OS keyring); `false` means it is
 * not; an absent/unavailable source field keeps its own worded state and no
 * yes/no is claimed.
 */
function KeyState({
  label,
  detail,
  field,
}: {
  readonly label: string;
  readonly detail: string;
  readonly field: FieldState | undefined;
}) {
  const present = fieldBool(field);
  const state: { word: string; tone: ChipTone; icon: LucideIcon } =
    present === true
      ? { word: "present", tone: "good", icon: Lock }
      : present === false
        ? { word: "not present", tone: "warn", icon: Unlock }
        : { word: "unreadable", tone: "neutral", icon: KeyRound };
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
      <span
        className={cn(
          "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border",
          CHIP_TONE[state.tone],
        )}
      >
        <state.icon aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-medium">
          {label}
          <span
            className={cn(
              "text-[12px] font-semibold",
              state.tone === "good"
                ? "text-success"
                : state.tone === "warn"
                  ? "text-warning"
                  : "text-muted-foreground",
            )}
          >
            {present === null ? (
              <MaybeFieldStateText field={field} />
            ) : (
              state.word
            )}
          </span>
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

/**
 * The encryption posture card — the two OS-crypt key-presence booleans read
 * as what they decide: whether the analyzer's host can decrypt this Case's
 * cookies, passwords, and payment data at all. These booleans are otherwise
 * buried as raw `true`/`false` cells; here they are the forensically decisive
 * reading they deserve, still worded, never a colour-only verdict.
 */
function EncryptionPosture({ browser }: { readonly browser: Finding | null }) {
  if (browser === null) {
    return null;
  }
  const standard = fieldBool(browser.fields.osCryptKeyPresent);
  const appBound = fieldBool(browser.fields.osCryptAppBoundKeyPresent);
  const summary =
    standard === true
      ? appBound === true
        ? "Both encryption keys are on disk — the strongest decryption position."
        : "The standard key is on disk; app-bound protected data may not decrypt."
      : standard === false
        ? "No standard key on disk — encrypted values will not decrypt from this evidence."
        : "Key presence could not be read from Local State.";
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <ShieldCheck
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
        <h2 className="text-[13px] font-semibold">Encryption posture</h2>
        <span className="ml-auto max-w-[46ch] truncate text-[12px] text-muted-foreground">
          {summary}
        </span>
      </header>
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <KeyState
          label="Standard OS-crypt key"
          detail="Protects cookies, saved logins, and autofill values."
          field={browser.fields.osCryptKeyPresent}
        />
        <KeyState
          label="App-bound encryption key"
          detail="Newer, app-scoped key for the most sensitive values."
          field={browser.fields.osCryptAppBoundKeyPresent}
        />
      </div>
    </section>
  );
}

/* ---------------------------- Profile roster ------------------------------ */

/** One field line inside a profile card. */
function ProfileField({
  label,
  field,
}: {
  readonly label: string;
  readonly field: FieldState | undefined;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] leading-none font-medium tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1.5">
        <MaybeFieldStateText field={field} truncate />
      </dd>
    </div>
  );
}

/**
 * A profile identity card. The headline is the best human name the row
 * carries (full name, then profile name, then the directory key), the initial
 * tile is drawn from that name, and the two derived chips restate the last
 * exit and the account state in plain words. Clicking the card opens the same
 * row detail sheet the table below opens, so every wire field stays one click
 * away from either view.
 */
function ProfileCard({
  row,
  onSelect,
}: {
  readonly row: Finding;
  readonly onSelect: (row: Finding) => void;
}) {
  const fullName = fieldString(row.fields.accountFullName);
  const profileName = fieldString(row.fields.profileName);
  const headline = fullName ?? profileName ?? profileLabel(row.profile);
  const exit = exitChip(row.fields.exitType);
  const account = accountChip(row.fields);
  const initial = headline.trim().charAt(0).toLocaleUpperCase("en-US") || "?";
  return (
    <button
      type="button"
      aria-label={`Open profile detail for ${headline}`}
      onClick={() => {
        onSelect(row);
      }}
      className="group flex cursor-pointer flex-col gap-3.5 rounded-lg border border-border bg-card p-4 text-left transition-colors duration-150 hover:border-accent-border hover:bg-accent/25"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-[17px] font-semibold text-accent-foreground">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            {headline}
          </p>
          <p className="truncate font-mono text-[11.5px] text-muted-foreground">
            {profileLabel(row.profile)}
          </p>
        </div>
      </div>

      {exit !== null || account !== null ? (
        <div className="flex flex-wrap gap-1.5">
          {account !== null ? (
            <Chip
              icon={account.icon}
              label={account.label}
              tone={account.tone}
              title={account.title}
            />
          ) : null}
          {exit !== null ? (
            <Chip
              icon={exit.icon}
              label={exit.label}
              tone={exit.tone}
              title={exit.title}
            />
          ) : null}
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/70 pt-3.5">
        <ProfileField label="Account e-mail" field={row.fields.accountEmail} />
        <ProfileField label="Locale" field={row.fields.accountLocale} />
        <ProfileField label="Profile name" field={row.fields.profileName} />
        <ProfileField
          label="Created by version"
          field={row.fields.createdByVersion}
        />
      </dl>
    </button>
  );
}

/* ------------------------------ Raw fields table -------------------------- */

/**
 * Every recorded field of every Metadata row, kept verbatim. Metadata rows do
 * not share one column set (a browser row and a profile row carry different
 * fields), so the raw view is a long two-column key/value table per row rather
 * than one wide grid — the shape that stays readable when the field set
 * differs. Each field renders through the shared Field State text, so a value,
 * an empty string, an absent field, and an unavailable field stay four
 * distinct, worded states.
 */

/** Reading order and plain labels for the fields worth surfacing in the table.
 *  Anything a row carries that is not listed here is still reachable in the
 *  detail sheet; this is the curated, examiner-first subset, not a cap on the
 *  evidence. */
const FIELD_LABELS: readonly { readonly key: string; readonly label: string }[] =
  [
    { key: "scope", label: "Scope" },
    { key: "chromeVersion", label: "Chrome version" },
    { key: "lastUsedProfile", label: "Last used profile" },
    { key: "variationsCountry", label: "Variations region" },
    { key: "profileCount", label: "Profiles on device" },
    { key: "osCryptKeyPresent", label: "Standard OS-crypt key" },
    { key: "osCryptAppBoundKeyPresent", label: "App-bound key" },
    { key: "profileName", label: "Profile name" },
    { key: "createdByVersion", label: "Created by version" },
    { key: "exitType", label: "Last exit type" },
    { key: "accountCount", label: "Accounts on profile" },
    { key: "accountEmail", label: "Account e-mail" },
    { key: "accountFullName", label: "Account full name" },
    { key: "accountGivenName", label: "Account given name" },
    { key: "accountLocale", label: "Account locale" },
    { key: "accountHostedDomain", label: "Hosted domain" },
    { key: "accountGaiaId", label: "Account ID (GAIA)" },
    { key: "screenWorkArea", label: "Screen work area" },
    { key: "avatarIcon", label: "Avatar icon" },
    { key: "gaiaName", label: "GAIA name" },
    { key: "infoCacheUserName", label: "Info-cache user name" },
    { key: "isUsingDefaultAvatar", label: "Using default avatar" },
    { key: "isUsingDefaultName", label: "Using default name" },
  ];

function RawFieldsTable({
  row,
  onSelect,
}: {
  readonly row: Finding;
  readonly onSelect: (row: Finding) => void;
}) {
  const scope =
    row.findingKind === "browser_metadata" ? "Browser" : "Profile";
  const headline =
    fieldString(row.fields.accountFullName) ??
    fieldString(row.fields.profileName) ??
    (row.findingKind === "browser_metadata"
      ? "Local State"
      : profileLabel(row.profile));
  const present = FIELD_LABELS.filter(({ key }) => key in row.fields);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border px-4 py-2.5">
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {scope}
        </span>
        <h3 className="truncate text-[13px] font-semibold">{headline}</h3>
        <span className="font-mono text-[11.5px] text-muted-foreground">
          {profileLabel(row.profile)}
        </span>
        <button
          type="button"
          onClick={() => {
            onSelect(row);
          }}
          className="ml-auto cursor-pointer text-[12px] font-medium text-primary underline-offset-4 transition-colors hover:underline"
        >
          Open detail
        </button>
      </header>
      <table className="w-full text-left text-[13px]">
        <thead className="sr-only">
          <tr>
            <th>Field</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {present.map(({ key, label }) => (
            <tr
              key={key}
              className="border-b border-border/60 last:border-b-0"
            >
              <th
                scope="row"
                className="w-[42%] max-w-[240px] px-4 py-2 text-left align-top text-[12px] font-medium text-muted-foreground"
              >
                {label}
              </th>
              <td className="px-4 py-2 align-top">
                <MaybeFieldStateText field={row.fields[key]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ---------------------------------- Page ---------------------------------- */

export function MetadataPage({
  config,
}: {
  readonly config: ArtifactConfig;
}) {
  const list = useMetadata(config.route);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");

  const browser = useMemo(
    () =>
      list.rows.find((row) => row.findingKind === "browser_metadata") ?? null,
    [list.rows],
  );
  const profiles = useMemo(
    () => list.rows.filter((row) => row.findingKind === "profile_metadata"),
    [list.rows],
  );

  const visibleProfiles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    if (query === "") {
      return profiles;
    }
    return profiles.filter((row) => {
      const haystack = [
        profileLabel(row.profile),
        fieldString(row.fields.profileName) ?? "",
        fieldString(row.fields.accountFullName) ?? "",
        fieldString(row.fields.accountEmail) ?? "",
      ]
        .join("\n")
        .toLocaleLowerCase("en-US");
      return haystack.includes(query);
    });
  }, [profiles, search]);

  const profilesFiltered = visibleProfiles.length !== profiles.length;

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  return (
    <div className="flex flex-col gap-4">

      {list.error !== null ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-destructive-border bg-destructive-wash px-3.5 py-3"
        >
          <div className="flex-1">
            <p className="text-[13px] font-medium text-destructive">
              The rows could not be loaded.
            </p>
            <p className="text-[12.5px] text-destructive/80">{list.error}</p>
          </div>
          <Button onClick={list.retry} size="sm" className="shrink-0">
            Retry
          </Button>
        </div>
      ) : list.loading && list.rows.length === 0 ? (
        <div className="flex flex-col gap-3" aria-label="Loading rows">
          <Skeleton className="h-[196px] w-full rounded-2xl" />
          <Skeleton className="h-[132px] w-full" />
          <Skeleton className="h-[210px] w-full" />
        </div>
      ) : list.rows.length === 0 ? (
        <EmptyRows message="No browser profile metadata in this Case." />
      ) : (
        <>
          <EnvironmentBanner browser={browser} />

          <EncryptionPosture browser={browser} />

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex items-center gap-2">
                <Users
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
                <h2 className="text-[13px] font-semibold">Profiles</h2>
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {profiles.length}
                </span>
              </div>
              {profiles.length > 3 ? (
                <label className="relative ml-auto">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                    }}
                    placeholder="Search profile or account"
                    aria-label="Search loaded profiles"
                    className="h-8 w-[220px] rounded-md border border-input bg-background pr-3 pl-8 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              ) : null}
            </div>
            {visibleProfiles.length === 0 ? (
              <div className="rounded-lg border border-border bg-card">
                <EmptyRows
                  message={
                    profilesFiltered
                      ? "No profiles match this search."
                      : "No profile-level metadata in this Case."
                  }
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleProfiles.map((row, index) => (
                  <ProfileCard
                    key={`${row.profile}-${String(index)}`}
                    row={row}
                    onSelect={select}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[13px] font-semibold">All recorded fields</h2>
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {list.rows.length}
              </span>
              <span className="text-[12px] text-muted-foreground">
                row{list.rows.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {list.rows.map((row, index) => (
                <RawFieldsTable
                  key={`${row.findingKind}-${row.profile}-${String(index)}`}
                  row={row}
                  onSelect={select}
                />
              ))}
            </div>
            {list.cursor !== null ? (
              <div className="flex items-center gap-3">
                <p
                  className="text-[12.5px] text-muted-foreground tabular-nums"
                  aria-live="polite"
                >
                  {list.rows.length} row{list.rows.length === 1 ? "" : "s"} shown
                  · more available
                </p>
                <Button
                  onClick={list.loadMore}
                  disabled={list.loading}
                  size="sm"
                >
                  {list.loading ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </section>
        </>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
