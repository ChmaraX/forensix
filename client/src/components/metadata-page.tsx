/**
 * The Browser profile page.
 *
 * Metadata is not a stream of events, so this page does not draw a timeline.
 * It reads the two things the Metadata artifact actually carries and frames
 * each as what an examiner asks of it:
 *
 *  - the one browser-level Finding (Local State) — the environment: which
 *    Chrome, which locale region, how many profiles — read as an environment
 *    panel;
 *  - the encryption posture the whole Case inherits, read straight off the
 *    two OS-crypt key-presence booleans and stated in the terms that decide
 *    whether encrypted evidence can be read at all;
 *  - one profile-level Finding per Profile (Preferences + info_cache) — the
 *    account behind each profile — read as a grid of FF cards (fluid hover),
 *    each carrying two derived, plain-language badges: how the profile last
 *    shut down (clean exit vs crash) and whether it is a signed-in account or
 *    a default local profile.
 *
 * Every derived badge is a reading of a value the row already carries, never
 * a new fact: an absent or unavailable source field collapses its badge to
 * the same worded state the field list shows, so a conclusion is never
 * asserted past the evidence. The field list below keeps every curated field
 * verbatim, one row at a time behind FF subtle tabs, and the detail sheet
 * keeps every wire field and its provenance.
 *
 * Presentation rules kept: value / (empty) / absent / unavailable stay
 * distinct words, never colour alone; nothing here is inference presented as
 * a factual summary tile.
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

import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelFooter,
  PanelHeader,
  PanelTitle,
} from "@/components/panel";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardGroup,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import {
  TabsSubtle,
  TabsSubtleItem,
  TabsSubtlePanel,
} from "@/components/ui/tabs-subtle";
import { Tooltip } from "@/components/ui/tooltip";
import { fontWeights } from "@/lib/font-weight";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { callApi } from "../api.js";
import type { ArtifactConfig, FieldState, Finding, PageOf } from "../types.js";
import { Count, IconTile, SectionHeading, Toolbar } from "./cache-kit.js";
import { EmptyRows } from "./data-table.js";
import { EvidenceBadge, type EvidenceState } from "./evidence.js";
import { MaybeFieldStateText } from "./field-state.js";
import { FilterTextField } from "./filters.js";
import { ErrorRows } from "./list-states.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";

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

/** Whether a media query matches, kept in step with the viewport. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => globalThis.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = globalThis.matchMedia(query);
    const onChange = () => {
      setMatches(list.matches);
    };
    onChange();
    list.addEventListener("change", onChange);
    return () => {
      list.removeEventListener("change", onChange);
    };
  }, [query]);
  return matches;
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

/** A stable, human label for a profile directory key (`.` is the sole profile). */
function profileLabel(profile: string): string {
  return profile === "." ? "Default profile" : profile;
}

/** The best human name a row carries: full name, profile name, then its key. */
function rowHeadline(row: Finding): string {
  return (
    fieldString(row.fields.accountFullName) ??
    fieldString(row.fields.profileName) ??
    (row.findingKind === "browser_metadata"
      ? "Local State"
      : profileLabel(row.profile))
  );
}

/* ------------------------------ Derived badges ---------------------------- */

interface Reading {
  readonly label: string;
  readonly color: BadgeColor;
  readonly icon: LucideIcon;
  readonly title: string;
}

/**
 * The last-shutdown reading of a profile, from its `exitType`. Chrome writes
 * "Normal" on a clean quit and "Crashed" / "SessionEnded" otherwise; anything
 * else is shown verbatim rather than guessed at, and an absent value yields no
 * badge at all (the field list still shows the field's own state).
 */
function exitReading(field: FieldState | undefined): Reading | null {
  const raw = fieldString(field);
  if (raw === null) {
    return null;
  }
  const normalized = raw.toLocaleLowerCase("en-US");
  if (normalized === "normal") {
    return {
      label: "Clean exit",
      color: "green",
      icon: CircleCheck,
      title: `exit_type recorded as "${raw}"`,
    };
  }
  if (normalized === "crashed") {
    return {
      label: "Crashed",
      color: "amber",
      icon: AlertTriangle,
      title: `exit_type recorded as "${raw}": the profile did not shut down cleanly`,
    };
  }
  return {
    label: raw,
    color: "gray",
    icon: AlertTriangle,
    title: `exit_type recorded as "${raw}"`,
  };
}

/**
 * Whether a profile is a signed-in Google account or a local default profile.
 * A recorded account e-mail is the deciding fact; `isUsingDefaultName === true`
 * with no e-mail is the local case. When neither can be read, no badge is drawn.
 */
function accountReading(fields: Finding["fields"]): Reading | null {
  const email = fieldString(fields.accountEmail);
  if (email !== null) {
    return {
      label: "Signed-in account",
      color: "blue",
      icon: UserRound,
      title: `Account e-mail on record: ${email}`,
    };
  }
  const defaultName = fieldBool(fields.isUsingDefaultName);
  if (defaultName === true) {
    return {
      label: "Local profile",
      color: "gray",
      icon: UserRound,
      title: "No account e-mail recorded; the profile uses its default name",
    };
  }
  return null;
}

/** A derived reading as an FF dot Badge, its source on hover. */
function ReadingBadge({ reading }: { readonly reading: Reading }) {
  return (
    <Tooltip content={reading.title}>
      <Badge variant="dot" color={reading.color} tabIndex={0}>
        {reading.label}
      </Badge>
    </Tooltip>
  );
}

/* ------------------------------ Shared pieces ----------------------------- */

/** A label over a value: the key/value pair every panel here is made of. */
function Fact({
  icon: Icon,
  label,
  field,
}: {
  readonly icon?: LucideIcon;
  readonly label: string;
  readonly field: FieldState | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt
        className={cn(
          typeClass("caption"),
          "flex items-center gap-1.5 text-muted-foreground",
        )}
      >
        {Icon === undefined ? null : (
          <Icon aria-hidden="true" size={13} strokeWidth={1.5} />
        )}
        {label}
      </dt>
      <dd className="min-w-0 text-foreground">
        <MaybeFieldStateText field={field} truncate />
      </dd>
    </div>
  );
}

/* --------------------------- Environment panel ---------------------------- */

/**
 * The environment — the browser-level Metadata Finding, framed as the
 * machine context every profile below sits inside.
 */
function EnvironmentPanel({ browser }: { readonly browser: Finding | null }) {
  const chromeVersion =
    browser === null ? null : fieldString(browser.fields.chromeVersion);
  return (
    <Panel aria-label="Browser environment">
      <PanelHeader>
        <div className="flex min-w-0 items-center gap-3">
          <IconTile icon={Chrome} />
          <div className="flex min-w-0 flex-col">
            <PanelTitle className="truncate">
              {chromeVersion === null
                ? "Chrome browser"
                : `Chrome ${chromeVersion}`}
            </PanelTitle>
            <PanelDescription>
              Environment recorded in Local State
            </PanelDescription>
          </div>
        </div>
      </PanelHeader>
      <PanelContent className="pt-3">
        {browser === null ? (
          <p className={cn(typeClass("body"), "text-muted-foreground")}>
            No browser-level metadata was recovered for this Case.
          </p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Fact
              icon={Users}
              label="Profiles on device"
              field={browser.fields.profileCount}
            />
            <Fact
              icon={UserRound}
              label="Last used profile"
              field={browser.fields.lastUsedProfile}
            />
            <Fact
              icon={Globe2}
              label="Variations region"
              field={browser.fields.variationsCountry}
            />
            <Fact
              icon={Chrome}
              label="Chrome version"
              field={browser.fields.chromeVersion}
            />
          </dl>
        )}
      </PanelContent>
    </Panel>
  );
}

/* ------------------------- Encryption posture panel ----------------------- */

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
  const reading: {
    readonly word: string;
    readonly state: EvidenceState;
    readonly icon: LucideIcon;
  } | null =
    present === true
      ? { word: "present", state: "produced", icon: Lock }
      : present === false
        ? { word: "not present", state: "warning", icon: Unlock }
        : null;
  return (
    <li className="flex items-center gap-3 py-3">
      <IconTile icon={reading?.icon ?? KeyRound} />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className={cn(typeClass("body"), "text-foreground")}>{label}</p>
        <p className={cn(typeClass("caption"), "text-muted-foreground")}>
          {detail}
        </p>
      </div>
      <div className="shrink-0">
        {reading === null ? (
          <MaybeFieldStateText field={field} />
        ) : (
          <EvidenceBadge state={reading.state}>{reading.word}</EvidenceBadge>
        )}
      </div>
    </li>
  );
}

/**
 * The encryption posture — the two OS-crypt key-presence booleans read as
 * what they decide: whether the analyzer's host can decrypt this Case's
 * cookies, passwords, and payment data at all. Still worded, never a
 * colour-only verdict.
 */
function EncryptionPanel({ browser }: { readonly browser: Finding }) {
  const standard = fieldBool(browser.fields.osCryptKeyPresent);
  const appBound = fieldBool(browser.fields.osCryptAppBoundKeyPresent);
  const summary =
    standard === true
      ? appBound === true
        ? "Both encryption keys are on disk: the strongest decryption position."
        : "The standard key is on disk; app-bound protected data may not decrypt."
      : standard === false
        ? "No standard key on disk: encrypted values will not decrypt from this evidence."
        : "Key presence could not be read from Local State.";
  return (
    <Panel aria-label="Encryption posture">
      <PanelHeader>
        <div className="flex min-w-0 items-center gap-3">
          <IconTile icon={ShieldCheck} />
          <div className="flex min-w-0 flex-col">
            <PanelTitle>Encryption posture</PanelTitle>
            <PanelDescription>{summary}</PanelDescription>
          </div>
        </div>
      </PanelHeader>
      <PanelContent className="pt-1 pb-1">
        <ul className="flex flex-col divide-y divide-border">
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
        </ul>
      </PanelContent>
    </Panel>
  );
}

/* ---------------------------- Profile roster ------------------------------ */

/**
 * A profile identity card. The headline is the best human name the row
 * carries (full name, then profile name, then the directory key), the initial
 * tile is drawn from that name, and the two derived badges restate the last
 * exit and the account state in plain words. Clicking the card opens the row
 * detail sheet, so every wire field stays one click away.
 */
function ProfileCard({
  row,
  onSelect,
  index,
}: {
  readonly row: Finding;
  readonly onSelect: (row: Finding) => void;
  /** Injected by CardGroup. */
  readonly index?: number;
}) {
  const headline = rowHeadline(row);
  const exit = exitReading(row.fields.exitType);
  const account = accountReading(row.fields);
  const initial = headline.trim().charAt(0).toLocaleUpperCase("en-US") || "?";
  return (
    <Card
      index={index}
      label={`Open profile detail for ${headline}`}
      onClick={() => {
        onSelect(row);
      }}
    >
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              typeClass("subtitle"),
              "inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-hover text-foreground",
            )}
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            {initial}
          </span>
          <div className="flex min-w-0 flex-col">
            <CardTitle className="truncate">{headline}</CardTitle>
            <span
              className={cn(
                typeClass("caption"),
                "truncate font-mono text-muted-foreground",
              )}
            >
              {profileLabel(row.profile)}
            </span>
          </div>
        </div>
      </CardHeader>
      {exit !== null || account !== null ? (
        <CardFooter className="gap-1.5">
          {account === null ? null : <ReadingBadge reading={account} />}
          {exit === null ? null : <ReadingBadge reading={exit} />}
        </CardFooter>
      ) : null}
      <CardContent className="pt-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Account e-mail" field={row.fields.accountEmail} />
          <Fact label="Locale" field={row.fields.accountLocale} />
          <Fact label="Profile name" field={row.fields.profileName} />
          <Fact
            label="Created by version"
            field={row.fields.createdByVersion}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Recorded fields --------------------------- */

/** Reading order and plain labels for the fields worth surfacing in the list.
 *  Anything a row carries that is not listed here is still reachable in the
 *  detail sheet; this is the curated, examiner-first subset, not a cap on the
 *  evidence. */
const FIELD_LABELS: readonly {
  readonly key: string;
  readonly label: string;
}[] = [
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

const LISTED_KEYS = new Set(FIELD_LABELS.map(({ key }) => key));

/**
 * Every curated field of one Metadata row, verbatim, as a key/value list.
 * Metadata rows do not share one column set (a browser row and a profile row
 * carry different fields), so a two-column list per row stays readable where
 * one wide grid would not. Each value renders through the shared Field State
 * text, so a value, an empty string, an absent field, and an unavailable
 * field stay four distinct, worded states.
 */
function FieldList({ row }: { readonly row: Finding }) {
  const present = FIELD_LABELS.filter(({ key }) => key in row.fields);
  const unlisted = Object.keys(row.fields).filter(
    (key) => !LISTED_KEYS.has(key),
  ).length;
  return (
    <>
      <dl className="flex flex-col px-4">
        {present.map(({ key, label }) => (
          <div
            key={key}
            className="grid grid-cols-1 gap-x-6 gap-y-0.5 border-b border-border py-2 last:border-b-0 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
          >
            <dt className={cn(typeClass("body"), "text-muted-foreground")}>
              {label}
            </dt>
            <dd className={cn(typeClass("body"), "min-w-0 text-foreground")}>
              <MaybeFieldStateText field={row.fields[key]} />
            </dd>
          </div>
        ))}
      </dl>
      {unlisted > 0 ? (
        <p
          className={cn(
            typeClass("caption"),
            "px-4 pt-2 text-muted-foreground",
          )}
        >
          {unlisted} more field{unlisted === 1 ? "" : "s"} in the row detail.
        </p>
      ) : null}
    </>
  );
}

/** The skeleton for the first load, no taller than the real blocks. */
function MetadataSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-[188px] w-full rounded-xl" />
        <Skeleton className="h-[188px] w-full rounded-xl" />
      </div>
      <Skeleton className="h-9 w-48 rounded-lg" />
      <Skeleton className="h-[200px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------- Page ---------------------------------- */

export function MetadataPage({ config }: { readonly config: ArtifactConfig }) {
  const list = useMetadata(config.route);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");
  const [fieldsTab, setFieldsTab] = useState(0);
  const wide = useMediaQuery("(min-width: 768px)");
  const extraWide = useMediaQuery("(min-width: 1280px)");

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
  const columns = Math.max(
    1,
    Math.min(visibleProfiles.length, extraWide ? 3 : wide ? 2 : 1),
  );

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  // Keep the field tab on a row that exists (rows only grow, but a retry
  // starts the list over).
  const activeTab = Math.min(fieldsTab, Math.max(0, list.rows.length - 1));
  const activeRow = list.rows[activeTab];

  const ready = !(list.loading && list.rows.length === 0);

  return (
    <div className="flex flex-col gap-5">
      {list.error !== null && list.rows.length === 0 ? (
        <Panel>
          <ErrorRows message={list.error} onRetry={list.retry} />
        </Panel>
      ) : ready && list.rows.length === 0 ? (
        <Panel>
          <EmptyRows
            icon={UserRound}
            title="No browser profile metadata"
            message="No browser profile metadata in this Case."
          />
        </Panel>
      ) : (
        <div className="reveal-swap">
          <MetadataSkeleton />
          {ready ? (
            <div className="flex flex-col gap-5">
              <div className="grid gap-5 lg:grid-cols-2">
                <div
                  className={cn(
                    "flex min-w-0 flex-col [&>*]:flex-1",
                    browser === null && "lg:col-span-2",
                  )}
                >
                  <EnvironmentPanel browser={browser} />
                </div>
                {browser === null ? null : (
                  <div className="flex min-w-0 flex-col [&>*]:flex-1">
                    <EncryptionPanel browser={browser} />
                  </div>
                )}
              </div>

              <section aria-label="Profiles" className="flex flex-col gap-3">
                <SectionHeading
                  title="Profiles"
                  count={
                    profilesFiltered
                      ? `${String(visibleProfiles.length)} of ${String(profiles.length)}`
                      : profiles.length
                  }
                  className="mt-3"
                >
                  {profiles.length > 3 ? (
                    <Toolbar>
                      <FilterTextField
                        label="Search loaded profiles"
                        icon={Search}
                        placeholder="Search profile or account…"
                        value={search}
                        onCommit={setSearch}
                      />
                    </Toolbar>
                  ) : null}
                </SectionHeading>
                <Panel className="overflow-clip">
                  {visibleProfiles.length === 0 ? (
                    <EmptyRows
                      message={
                        profilesFiltered
                          ? "No profiles match this search."
                          : "No profile-level metadata in this Case."
                      }
                      action={
                        profilesFiltered ? (
                          <Button
                            variant="tertiary"
                            size="compact"
                            onClick={() => {
                              setSearch("");
                            }}
                          >
                            Clear search
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <CardGroup columns={columns}>
                      {visibleProfiles.map((row, index) => (
                        <ProfileCard
                          key={`${row.profile}-${String(index)}`}
                          row={row}
                          onSelect={select}
                        />
                      ))}
                    </CardGroup>
                  )}
                </Panel>
              </section>

              <section
                aria-label="All recorded fields"
                className="flex flex-col gap-3"
              >
                <SectionHeading
                  title="All recorded fields"
                  count={`${String(list.rows.length)} row${list.rows.length === 1 ? "" : "s"}`}
                  description="Each Metadata row's examiner-first fields, verbatim. Every wire field and its source row are in the row detail."
                  className="mt-3"
                />
                <Panel className="overflow-clip">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-3 py-2">
                    <TabsSubtle
                      idPrefix="metadata-fields"
                      size="compact"
                      selectedIndex={activeTab}
                      onSelect={setFieldsTab}
                      className="min-w-0"
                    >
                      {list.rows.map((row, index) => (
                        <TabsSubtleItem
                          key={`${row.findingKind}-${row.profile}-${String(index)}`}
                          index={index}
                          icon={
                            row.findingKind === "browser_metadata"
                              ? Chrome
                              : UserRound
                          }
                          label={rowHeadline(row)}
                        />
                      ))}
                    </TabsSubtle>
                    {activeRow === undefined ? null : (
                      <div className="flex items-center gap-3">
                        <Count>
                          {activeRow.findingKind === "browser_metadata"
                            ? "Browser"
                            : "Profile"}{" "}
                          ·{" "}
                          <span className="font-mono">
                            {profileLabel(activeRow.profile)}
                          </span>
                        </Count>
                        <Button
                          variant="tertiary"
                          size="compact"
                          onClick={() => {
                            select(activeRow);
                          }}
                        >
                          Open detail
                        </Button>
                      </div>
                    )}
                  </div>
                  {list.rows.map((row, index) => (
                    <TabsSubtlePanel
                      key={`${row.findingKind}-${row.profile}-${String(index)}`}
                      idPrefix="metadata-fields"
                      index={index}
                      selectedIndex={activeTab}
                      className="py-2"
                    >
                      <FieldList row={row} />
                    </TabsSubtlePanel>
                  ))}
                  {list.cursor !== null || list.error !== null ? (
                    <PanelFooter>
                      {list.error !== null ? (
                        <p
                          className={cn(
                            typeClass("caption"),
                            "text-destructive",
                          )}
                        >
                          More rows could not be loaded: {list.error}
                        </p>
                      ) : (
                        <p
                          className={cn(
                            typeClass("caption"),
                            "text-muted-foreground tabular-nums",
                          )}
                          aria-live="polite"
                        >
                          {list.rows.length} row
                          {list.rows.length === 1 ? "" : "s"} shown · more
                          available
                        </p>
                      )}
                      {list.cursor !== null ? (
                        <Button
                          variant="tertiary"
                          size="compact"
                          className="ml-auto"
                          onClick={list.loadMore}
                          loading={list.loading}
                          disabled={list.loading}
                        >
                          Load more
                        </Button>
                      ) : null}
                    </PanelFooter>
                  ) : null}
                </Panel>
              </section>
            </div>
          ) : null}
        </div>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={
            selected.row.findingKind === "browser_metadata"
              ? "Browser metadata"
              : "Profile metadata"
          }
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
