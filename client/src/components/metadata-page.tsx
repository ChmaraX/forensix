/**
 * The Browser profile page.
 *
 * Metadata is not a stream of events, so this page draws no timeline. It
 * reads what the Metadata artifact carries, each framed as what an examiner
 * asks of it:
 *
 *  - the one browser-level Finding (Local State) — the environment: which
 *    Chrome, how many profiles, which was last used, which variations
 *    region — read as the page's figure strip;
 *  - one profile-level Finding per Profile (Preferences + info_cache) — the
 *    account behind each profile — as a grid of FF cards (fluid hover), each
 *    with two plain-language badges: how the profile last shut down and
 *    whether it is a signed-in account or a local profile;
 *  - "Recorded fields": every curated field of every row, one row after
 *    another (or one row picked from the toolbar), each fact once - a saved
 *    row the strip or a card already shows lists only what they do not
 *    (Local State's two OS-crypt key readings, "present" / "not present",
 *    with the encryption posture in their tooltip). Saved rows and rows
 *    recovered from the WAL / rollback journal are separate server reads
 *    behind the Saved / Recovered switch; the detail sheet keeps every wire
 *    field and its provenance.
 *
 * Every derived badge is a reading of a value the row already carries,
 * never a new fact: an absent or unavailable source field collapses its
 * badge to the same worded state the field list shows. The strip and the
 * cards read the saved rows only.
 *
 * Presentation rules kept: value / (empty) / absent / unavailable stay
 * distinct words, never colour alone; saved and recovered rows are never
 * mixed; nothing here is inference presented as a factual summary tile.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { useViewTab } from "../view-state.js";

import { Panel } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  BrowserIcon,
  SearchIcon,
  UserIcon,
  type AppIcon,
} from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import type { ArtifactConfig, FieldState, Finding } from "../types.js";
import {
  type PaginatedList,
  type RecoveredList,
  useCommitStateLists,
} from "../use-commit-state-lists.js";
import { EmptyRows } from "./data-table.js";
import { EvidenceDot } from "./evidence.js";
import { MaybeFieldStateText } from "./field-state.js";
import {
  fieldBool,
  fieldString,
  profileLabel,
  StateWord,
} from "./finding-fields.js";
import { FilterField, FilterTextField } from "./filters.js";
import { ListBlock, RevealSwap } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { CommitStateSplit, SectionPanel, Toolbar } from "./page-kit.js";
import { Term } from "./term.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";

/** Browser row first, then profiles; each Commit State is its own read. */
const METADATA_PARAMETERS: QueryParameters = [
  ["sort", "type"],
  ["direction", "asc"],
];

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

/** A derived reading: its words, and — only for a reading that is a warning
 *  — the state its dot repeats. Every other reading is a plain label. */
interface Reading {
  readonly label: string;
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
function accountReading(fields: Finding["fields"]): Reading | null {
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
function ReadingBadge({ reading }: { readonly reading: Reading }) {
  return <Badge size="compact">{reading.label}</Badge>;
}

/* ------------------------------ Shared pieces ----------------------------- */

/** A label over a value: the key/value pair a profile card is made of. */
function Fact({
  label,
  field,
}: {
  readonly label: string;
  readonly field: FieldState | undefined;
}) {
  const size = useSize();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className={cn(size.type.caption, "text-muted-foreground")}>
        {label}
      </dt>
      <dd className="min-w-0 text-foreground">
        <MaybeFieldStateText field={field} truncate />
      </dd>
    </div>
  );
}

/** A recorded value as a strip figure; any other state keeps its own word. */
function FieldFigure({ field }: { readonly field: FieldState | undefined }) {
  const text = fieldString(field);
  if (text === null) {
    return <MaybeFieldStateText field={field} truncate />;
  }
  // A figure never truncates; a narrow tile wraps a dotted value (a Chrome
  // build) after a dot rather than mid-number. `<wbr>` adds no character,
  // so a copied value stays byte-for-byte.
  const parts = text.split(".");
  return (
    <span title={text}>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 ? (
            <>
              .<wbr />
            </>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/* ---------------------------- Environment strip --------------------------- */

/**
 * The environment — the saved browser-level Metadata Finding (Local State)
 * as the page's one figure strip: the machine context every profile below
 * sits inside.
 */
function EnvironmentStrip({ browser }: { readonly browser: Finding }) {
  return (
    <MetricBand className="grid-cols-2 lg:grid-cols-4">
      <MetricBandItem
        label="Chrome version"
        value={<FieldFigure field={browser.fields.chromeVersion} />}
      />
      <MetricBandItem
        label="Profiles on device"
        value={<FieldFigure field={browser.fields.profileCount} />}
      />
      <MetricBandItem
        label="Last used profile"
        value={<FieldFigure field={browser.fields.lastUsedProfile} />}
      />
      <MetricBandItem
        label="Variations region"
        value={<FieldFigure field={browser.fields.variationsCountry} />}
      />
    </MetricBand>
  );
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
const KEY_FIELDS: Readonly<Record<string, string>> = {
  osCryptKeyPresent: "Protects cookies, saved logins, and autofill values.",
  osCryptAppBoundKeyPresent:
    "Newer, app-scoped key for the most sensitive values.",
};

/** What the recorded key pair means for decryption, from the standard key
 *  first (the app-bound key only matters beside it). */
function postureOf(fields: Finding["fields"]): string {
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
function KeyPresence({ field }: { readonly field: FieldState | undefined }) {
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

/* ---------------------------- Profile roster ------------------------------ */

/**
 * A profile identity card. The headline is the best human name the row
 * carries (full name, then profile name, then the directory key), the initial
 * tile is drawn from that name, and the two derived badges restate the last
 * exit and the account state in plain words. Clicking anywhere on the card
 * (its footer badges included) opens the row detail sheet, so every wire
 * field stays one click away.
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
                "truncate text-muted-foreground",
              )}
            >
              {profileLabel(row.profile)}
            </span>
          </div>
        </div>
      </CardHeader>
      {exit !== null || account !== null ? (
        // The footer rises above the card's click overlay; nothing in it is
        // interactive, so it lets clicks through to the card.
        <CardFooter className="pointer-events-none gap-1.5">
          {account === null ? null : <ReadingBadge reading={account} />}
          {exit === null ? null : <ReadingBadge reading={exit} />}
        </CardFooter>
      ) : null}
      <CardContent className="pt-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {/* The e-mail gets the card's full width so an address is read
              whole, not cut. */}
          <div className="col-span-2 min-w-0">
            <Fact label="Account e-mail" field={row.fields.accountEmail} />
          </div>
          <Fact label="Profile name" field={row.fields.profileName} />
          <Fact label="Locale" field={row.fields.accountLocale} />
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
  { key: "chromeVersion", label: "Chrome version" },
  { key: "lastUsedProfile", label: "Last used profile" },
  { key: "variationsCountry", label: "Variations region" },
  { key: "profileCount", label: "Profiles on device" },
  { key: "osCryptKeyPresent", label: "Standard OS-crypt key" },
  { key: "osCryptAppBoundKeyPresent", label: "App-bound encryption key" },
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
 * The fields of a saved row that the panels above already show - the
 * browser row's four figures, a profile card's facts and readings - so the
 * recorded fields list each fact once. Recovered rows have no panel and
 * list every field; the detail sheet keeps every wire field of every row.
 */
function shownAbove(row: Finding): ReadonlySet<string> {
  if (row.findingKind === "browser_metadata") {
    return new Set([
      "chromeVersion",
      "profileCount",
      "lastUsedProfile",
      "variationsCountry",
    ]);
  }
  const keys = new Set([
    "accountEmail",
    "profileName",
    "accountLocale",
    "createdByVersion",
  ]);
  // The card's badge and headline carry these only when recorded.
  if (exitReading(row.fields.exitType) !== null) {
    keys.add("exitType");
  }
  if (fieldString(row.fields.accountFullName) !== null) {
    keys.add("accountFullName");
  }
  return keys;
}

/** A stable key for one Metadata row within its list. */
function rowKey(row: Finding, index: number): string {
  return `${row.commitState}:${row.findingKind}:${row.profile}:${String(index)}`;
}

/**
 * Every curated field of one Metadata row, verbatim, as a key/value list
 * under a small heading (the row's name, its kind and profile, and the way
 * into its detail sheet). Metadata rows do not share one column set (a
 * browser row and a profile row carry different fields), so a two-column
 * list per row stays readable where one wide grid would not. Each value
 * renders through the shared Field State text, so a value, an empty string,
 * an absent field, and an unavailable field stay four distinct, worded
 * states.
 */
function RowFields({
  row,
  summarized,
  onSelect,
}: {
  readonly row: Finding;
  /** The figure strip or a profile card shows this row above. */
  readonly summarized: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  const size = useSize();
  const above = summarized ? shownAbove(row) : new Set<string>();
  const present = FIELD_LABELS.filter(
    ({ key }) => key in row.fields && !above.has(key),
  );
  const unlisted = Object.keys(row.fields).filter(
    (key) => !LISTED_KEYS.has(key),
  ).length;
  const browserRow = row.findingKind === "browser_metadata";
  const Icon: AppIcon = browserRow ? BrowserIcon : UserIcon;
  return (
    <section
      aria-label={`Recorded fields of ${rowHeadline(row)}`}
      className="flex flex-col border-b border-border py-3 last:border-b-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-1">
        <Icon
          aria-hidden="true"
          size={size.icon}
          strokeWidth={1.5}
          className="shrink-0 text-muted-foreground"
        />
        <h3
          className={cn(typeClass("body"), "min-w-0 truncate text-foreground")}
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {rowHeadline(row)}
        </h3>
        <span className={cn(typeClass("caption"), "text-muted-foreground")}>
          {browserRow ? "Browser" : profileLabel(row.profile)}
        </span>
        {row.commitState === "committed" ? null : (
          <StateWord state={row.commitState} />
        )}
        <Button
          variant="tertiary"
          size="compact"
          className="ml-auto"
          onClick={() => {
            onSelect(row);
          }}
        >
          Open detail
        </Button>
      </div>
      <dl className="flex flex-col px-4">
        {present.map(({ key, label }) => (
          <div
            key={key}
            className="grid grid-cols-1 gap-x-6 gap-y-0.5 border-b border-border py-2 last:border-b-0 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
          >
            <dt className={cn(typeClass("body"), "text-muted-foreground")}>
              {key in KEY_FIELDS ? (
                <Term label={label}>
                  {KEY_FIELDS[key]}
                  {key === "osCryptKeyPresent"
                    ? ` ${postureOf(row.fields)}`
                    : null}
                </Term>
              ) : (
                label
              )}
            </dt>
            <dd className={cn(typeClass("body"), "min-w-0 text-foreground")}>
              {key in KEY_FIELDS ? (
                <KeyPresence field={row.fields[key]} />
              ) : (
                <MaybeFieldStateText field={row.fields[key]} />
              )}
            </dd>
          </div>
        ))}
      </dl>
      {unlisted > 0 ? (
        <div className="px-4 pt-1.5">
          <Button
            variant="ghost"
            size="compact"
            className="-ml-2 text-muted-foreground"
            aria-label={`Open the row detail: ${String(unlisted)} more ${unlisted === 1 ? "field" : "fields"}`}
            onClick={() => {
              onSelect(row);
            }}
          >
            {`+${String(unlisted)} ${unlisted === 1 ? "field" : "fields"}`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** No row is summarized above (the recovered list). */
const EMPTY_SET: ReadonlySet<Finding> = new Set();

/** "All rows" in the row picker. */
const ALL_ROWS = "all";

/**
 * One list (saved or recovered) of recorded fields: its loading rows, its
 * read error, its empty state, every row stacked (or the one row picked),
 * a load-more failure (Retry asks for that page again and keeps the loaded
 * rows), and the "N shown / Load more" footer.
 */
function FieldsList({
  list,
  noun,
  focus,
  summarized,
  onSelect,
}: {
  readonly list: PaginatedList<Finding> | RecoveredList<Finding>;
  readonly noun: "saved" | "recovered";
  /** The picked row's key, or ALL_ROWS. */
  readonly focus: string;
  /** Rows the panels above already show (their facts are not repeated). */
  readonly summarized: ReadonlySet<Finding>;
  readonly onSelect: (row: Finding) => void;
}) {
  const shown = list.rows.flatMap((row, index) => {
    const key = rowKey(row, index);
    return focus === ALL_ROWS || focus === key ? [{ key, row }] : [];
  });
  return (
    <ListBlock
      list={list}
      noun={{ one: `${noun} metadata row`, many: `${noun} metadata rows` }}
      shown={shown.length}
      empty={
        <EmptyRows
          message={
            noun === "saved"
              ? "No saved Metadata rows in this Case."
              : "No recovered Metadata rows in this Case."
          }
        />
      }
    >
      <div className="reveal-items flex flex-col">
        {shown.map(({ key, row }) => (
          <RowFields
            key={key}
            row={row}
            summarized={summarized.has(row)}
            onSelect={onSelect}
          />
        ))}
      </div>
    </ListBlock>
  );
}

/** Picks one row of the active list to read on its own, or every row
 *  stacked ("All rows", the default). */
function RowPicker({
  rows,
  value,
  onChange,
}: {
  readonly rows: readonly Finding[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  if (rows.length < 2) {
    return null;
  }
  return (
    <FilterField label="Show" htmlFor="metadata-row-picker">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="metadata-row-picker" />
        <SelectContent>
          <SelectItem index={0} value={ALL_ROWS}>
            All rows
          </SelectItem>
          {rows.map((row, index) => (
            <SelectItem
              key={rowKey(row, index)}
              index={index + 1}
              value={rowKey(row, index)}
            >
              {rowHeadline(row)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterField>
  );
}

/** Stands in for the figure strip and the profile grid while the first
 *  saved page loads, at their size. */
function FiguresSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-label="Loading browser profile metadata"
    >
      <Skeleton className="h-[148px] w-full rounded-xl lg:h-[74px]" />
      <Skeleton className="h-[260px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------- Page ---------------------------------- */

export function MetadataPage({ config }: { readonly config: ArtifactConfig }) {
  const lists = useCommitStateLists<Finding>(config.route, METADATA_PARAMETERS);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");
  // Saved / Recovered lives in the URL (`tab`): Back and a refresh keep it.
  const [view, setView] = useViewTab();
  const [focus, setFocus] = useState<string>(ALL_ROWS);
  const wide = useMediaQuery("(min-width: 768px)");

  const savedRows = lists.saved.rows;
  const recoveredRows = lists.recovered.rows;

  const browser = useMemo(
    () =>
      savedRows.find((row) => row.findingKind === "browser_metadata") ?? null,
    [savedRows],
  );
  const profiles = useMemo(
    () => savedRows.filter((row) => row.findingKind === "profile_metadata"),
    [savedRows],
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

  // The saved rows the strip and the cards show: their facts are not
  // listed again under "Recorded fields".
  const summarized = useMemo(
    () =>
      new Set<Finding>(browser === null ? profiles : [browser, ...profiles]),
    [browser, profiles],
  );

  const profilesFiltered = visibleProfiles.length !== profiles.length;
  const columns = Math.max(1, Math.min(visibleProfiles.length, wide ? 2 : 1));

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const activeRows = view === "saved" ? savedRows : recoveredRows;
  // A picked row that is no longer in the active list (the other tab, or a
  // retry that started the list over) falls back to every row.
  const activeFocus = activeRows.some(
    (row, index) => rowKey(row, index) === focus,
  )
    ? focus
    : ALL_ROWS;

  const savedFirst = lists.saved.loading && savedRows.length === 0;
  const recoveredFirst = lists.recovered.loading && recoveredRows.length === 0;
  const pageEmpty =
    !savedFirst &&
    !recoveredFirst &&
    lists.saved.error === null &&
    lists.recovered.error === null &&
    savedRows.length === 0 &&
    recoveredRows.length === 0;
  // The panels read the saved rows only; with none (or a failed read) they
  // step aside and the Saved tab below carries the reason.
  const showFigures =
    savedFirst || (lists.saved.error === null && savedRows.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {pageEmpty ? (
        <Panel>
          <EmptyRows
            icon={UserIcon}
            title="No browser profile metadata"
            message="No Metadata rows in this Case, saved or recovered."
          />
        </Panel>
      ) : (
        <>
          {showFigures ? (
            <RevealSwap loading={savedFirst} skeleton={<FiguresSkeleton />}>
              <div className="flex flex-col gap-5">
                {browser === null ? null : (
                  <EnvironmentStrip browser={browser} />
                )}
                <SectionPanel
                  id="metadata-profiles"
                  title="Profiles"
                  count={
                    profilesFiltered
                      ? `${String(visibleProfiles.length)} of ${String(profiles.length)}`
                      : profiles.length
                  }
                  className="min-w-0"
                >
                  {profiles.length > 3 ? (
                    <Toolbar>
                      <FilterTextField
                        commit="change"
                        label="Search loaded profiles"
                        icon={SearchIcon}
                        placeholder="Search profile or account"
                        value={search}
                        onCommit={setSearch}
                      />
                    </Toolbar>
                  ) : null}
                  {visibleProfiles.length === 0 ? (
                    <EmptyRows
                      message={
                        profilesFiltered
                          ? "No profiles match this search."
                          : "No saved profile-level metadata in this Case."
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
                    <div className="border-t border-border p-1">
                      <CardGroup columns={columns}>
                        {visibleProfiles.map((row, index) => (
                          <ProfileCard
                            key={rowKey(row, index)}
                            row={row}
                            onSelect={select}
                          />
                        ))}
                      </CardGroup>
                    </div>
                  )}
                </SectionPanel>
              </div>
            </RevealSwap>
          ) : null}

          <SectionPanel id="metadata-fields" title="Recorded fields">
            <CommitStateSplit
              value={view}
              onValueChange={(next) => {
                setView(next);
                setFocus(ALL_ROWS);
              }}
              label="Saved or recovered metadata rows"
              savedCount={
                savedFirst ||
                (lists.saved.error !== null && savedRows.length === 0)
                  ? null
                  : savedRows.length
              }
              recoveredCount={
                recoveredFirst ||
                (lists.recovered.error !== null && recoveredRows.length === 0)
                  ? null
                  : recoveredRows.length
              }
              savedMore={lists.saved.cursor !== null}
              recoveredMore={lists.recovered.cursor !== null}
              toolbar={
                <RowPicker
                  rows={activeRows}
                  value={activeFocus}
                  onChange={setFocus}
                />
              }
              saved={
                <FieldsList
                  list={lists.saved}
                  noun="saved"
                  focus={activeFocus}
                  summarized={summarized}
                  onSelect={select}
                />
              }
              recovered={
                <FieldsList
                  list={lists.recovered}
                  noun="recovered"
                  focus={activeFocus}
                  summarized={EMPTY_SET}
                  onSelect={select}
                />
              }
            />
          </SectionPanel>
        </>
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
