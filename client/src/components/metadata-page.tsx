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
 * Profiles are named one way, as everywhere else (`profileLabel`:
 * "Default profile", "Profile 2"); the account's own name sits under it.
 * The Profiles panel names every profile the Case knows (`caseProfilesOf`,
 * so it agrees with the coverage detail): a profile with no metadata row
 * says so, with the Completeness Statement's reason. The profile pick is
 * the Case-wide lens (`useViewProfiles`); the browser-level row belongs to
 * no profile and always shows. The open row is in the URL.
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
import { useMemo, useState } from "react";

import {
  updateView,
  useRowSelection,
  useViewProfiles,
  useViewTab,
} from "../view-state.js";

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
import { SearchIcon, UserIcon } from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import { useCaseContext } from "../case-context.js";
import type { CaseCompleteness, FieldState, Finding } from "../types.js";
import { ARTIFACTS } from "../artifacts.js";
import type { RowLookupSource } from "../row-lookup.js";
import {
  commitStateStatus,
  useCommitStateLists,
} from "../use-commit-state-lists.js";
import { CommitStatePage } from "./commit-state-page.js";
import { caseProfilesOf } from "./completeness.js";
import { EmptyRows } from "./data-table.js";
import { EvidenceDot, type EvidenceState } from "./evidence.js";
import { MaybeFieldStateText } from "./field-state.js";
import { profileLabel } from "./finding-fields.js";
import {
  FilterField,
  FilterTextField,
  matchesSearch,
  ProfilePicker,
} from "./filters.js";
import {
  accountReading,
  exitReading,
  personOf,
  ReadingBadge,
  rowHeadline,
} from "./metadata-readings.js";
import { EMPTY_SET, FieldsList, rowKey } from "./metadata-fields.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { CommitStateSplit, SectionPanel, Toolbar } from "./page-kit.js";
import { RowSheet } from "./row-sheet.js";
import { useMediaQuery } from "./use-media-query.js";
import { fieldString } from "../field-readers.js";

/** Browser row first, then profiles; each Commit State is its own read. */
const METADATA_PARAMETERS: QueryParameters = [
  ["sort", "type"],
  ["direction", "asc"],
];

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

/** A recorded value as a strip figure; any other state keeps its own word.
 *  `format` rewords a recorded value for reading (a profile directory as
 *  its label); the recorded value stays in the tooltip. */
function FieldFigure({
  field,
  format,
}: {
  readonly field: FieldState | undefined;
  readonly format?: (value: string) => string;
}) {
  const recorded = fieldString(field);
  if (recorded === null) {
    return <MaybeFieldStateText field={field} truncate />;
  }
  if (format !== undefined) {
    const shown = format(recorded);
    return (
      <span title={shown === recorded ? recorded : `Recorded: ${recorded}`}>
        {shown}
      </span>
    );
  }
  const text = recorded;
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
      {/* Chrome's own count, as Local State records it: it can differ
          from the profiles the Case knows (the Profiles panel below). */}
      <MetricBandItem
        label="Profiles in Local State"
        value={<FieldFigure field={browser.fields.profileCount} />}
      />
      <MetricBandItem
        label="Last used profile"
        value={
          <FieldFigure
            field={browser.fields.lastUsedProfile}
            format={profileLabel}
          />
        }
      />
      <MetricBandItem
        label="Variations region"
        value={<FieldFigure field={browser.fields.variationsCountry} />}
      />
    </MetricBand>
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
  const person = fieldString(row.fields.accountFullName);
  const exit = exitReading(row.fields.exitType);
  const account = accountReading(row.fields);
  const initial =
    (personOf(row) ?? headline).trim().charAt(0).toLocaleUpperCase("en-US") ||
    "?";
  return (
    <Card
      index={index}
      label={`Open profile detail for ${headline}${person === null ? "" : ` (${person})`}`}
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
            {/* The account's own name, when recorded; the profile is the
                title, named as on every other page. */}
            {person === null ? null : (
              <span
                className={cn(
                  typeClass("caption"),
                  "truncate text-muted-foreground",
                )}
                title={person}
              >
                {person}
              </span>
            )}
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

/* ------------------------- Profiles with no metadata ---------------------- */

/** Why a profile has no profile-level metadata row, from the Completeness
 *  Statement's Preferences entry for it (its outcome and reason). */
function unreadReason(
  profile: string,
  completeness: CaseCompleteness | null,
): {
  readonly state: EvidenceState;
  readonly word: string;
  readonly reason: string;
} {
  const entry = completeness?.statements
    .filter((statement) => statement.artifact === "Preferences")
    .flatMap((statement) => statement.artifacts)
    .find((database) => database.profile === profile);
  if (entry === undefined) {
    return {
      state: "absent",
      word: "not read",
      reason: "No Preferences database was read for this profile.",
    };
  }
  if (entry.outcome === "unavailable") {
    return {
      state: "unavailable",
      word: "unreadable",
      reason: entry.reason ?? "Preferences could not be read.",
    };
  }
  if (entry.outcome === "absent") {
    return {
      state: "absent",
      word: "not present",
      reason: entry.reason ?? "No Preferences database in this profile.",
    };
  }
  return {
    state: "absent",
    word: "no row",
    reason: "Preferences was read, but holds no saved profile row.",
  };
}

/**
 * The profiles the Case knows that have no saved profile-level metadata
 * row (a Guest profile whose databases were absent): each named as
 * everywhere, with the worded state and the reason - so the panel counts
 * every profile the coverage detail names, never fewer.
 */
function UnreadProfiles({
  profiles,
  completeness,
}: {
  readonly profiles: readonly string[];
  readonly completeness: CaseCompleteness | null;
}) {
  if (profiles.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-col border-t border-border px-4 py-2">
      {profiles.map((profile) => {
        const why = unreadReason(profile, completeness);
        return (
          <li
            key={profile}
            className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5"
          >
            <span
              className={cn(typeClass("body"), "text-foreground")}
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              {profileLabel(profile)}
            </span>
            <span
              className={cn(
                typeClass("caption"),
                "inline-flex items-center gap-1.5 text-foreground",
              )}
            >
              <EvidenceDot state={why.state} />
              {why.word}
            </span>
            <span
              className={cn(
                typeClass("caption"),
                "min-w-0 text-muted-foreground",
              )}
            >
              {why.reason}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Stands in for the figure strip and the profile grid while the first
 *  saved page loads, at their size. */
function FiguresSkeleton() {
  return (
    <div className="flex flex-col gap-5" role="status">
      <span className="sr-only">Loading browser profile metadata</span>
      <Skeleton className="h-[148px] w-full rounded-xl lg:h-[74px]" />
      <Skeleton className="h-[260px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------- Page ---------------------------------- */

const config = ARTIFACTS.metadata;
/** A URL-named row this page has not loaded is read by its reference. */
const ROW_LOOKUP: RowLookupSource = { route: config.route };

export function MetadataPage() {
  const lists = useCommitStateLists<Finding>(config.route, METADATA_PARAMETERS);
  const [search, setSearch] = useState("");
  // Saved / Recovered, the open row and the Case-wide profile pick live in
  // the URL: Back and a refresh keep them.
  const [view, setView] = useViewTab();
  const [profileFilter, setProfileFilter] = useViewProfiles();
  // The shell's one read of the profiles and the Completeness Statement.
  const caseContext = useCaseContext().context;
  const wide = useMediaQuery("(min-width: 768px)");

  const savedRows = lists.saved.rows;
  const recoveredRows = lists.recovered.rows;
  const loadedRows = useMemo(
    () => [...savedRows, ...recoveredRows],
    [savedRows, recoveredRows],
  );
  const sheet = useRowSelection(loadedRows, ROW_LOOKUP);

  const browser = useMemo(
    () =>
      savedRows.find((row) => row.findingKind === "browser_metadata") ?? null,
    [savedRows],
  );
  const profiles = useMemo(
    () => savedRows.filter((row) => row.findingKind === "profile_metadata"),
    [savedRows],
  );

  // The browser-level row belongs to no profile: the pick never hides it.
  const include = useMemo(
    () => (row: Finding) =>
      row.findingKind === "browser_metadata" ||
      profileFilter.length === 0 ||
      profileFilter.includes(row.profile),
    [profileFilter],
  );

  // Every profile the Case knows (the profiles route plus any the
  // Completeness Statement names), and those with no saved profile row.
  const knownProfiles = useMemo(() => {
    const fromRows = loadedRows
      .filter((row) => row.findingKind === "profile_metadata")
      .map((row) => row.profile);
    const known =
      caseContext === null
        ? fromRows
        : caseProfilesOf(
            [...caseContext.profiles, ...fromRows],
            caseContext.completeness,
          );
    return [...new Set([...known, ...profileFilter])].sort();
  }, [loadedRows, caseContext, profileFilter]);
  const unread = useMemo(() => {
    if (caseContext === null) {
      return [];
    }
    const withRow = new Set(profiles.map((row) => row.profile));
    return caseProfilesOf(caseContext.profiles, caseContext.completeness)
      .filter(
        (profile) =>
          !withRow.has(profile) &&
          (profileFilter.length === 0 || profileFilter.includes(profile)),
      )
      .sort();
  }, [caseContext, profiles, profileFilter]);

  const visibleProfiles = useMemo(
    () =>
      profiles.filter(
        (row) =>
          include(row) &&
          matchesSearch(search, [
            profileLabel(row.profile),
            fieldString(row.fields.profileName),
            fieldString(row.fields.accountFullName),
            fieldString(row.fields.accountEmail),
          ]),
      ),
    [profiles, search, include],
  );

  // The saved rows the strip and the cards show: their facts are not
  // listed again under "Recorded fields".
  const summarized = useMemo(
    () =>
      new Set<Finding>(browser === null ? profiles : [browser, ...profiles]),
    [browser, profiles],
  );

  // Every profile the panel names: the cards and the unread ones.
  const panelTotal =
    caseContext === null
      ? profiles.length
      : new Set([
          ...profiles.map((row) => row.profile),
          ...caseProfilesOf(caseContext.profiles, caseContext.completeness),
        ]).size;
  const panelShown = visibleProfiles.length + unread.length;
  const profilesFiltered = panelShown !== panelTotal;
  const columns = Math.max(1, Math.min(visibleProfiles.length, wide ? 2 : 1));

  const clearProfiles = () => {
    setSearch("");
    updateView({ profiles: [] });
  };

  // The panels read every saved row (the browser row belongs to no
  // profile); the lists narrow by the pick.
  const status = commitStateStatus(lists, {
    saved: savedRows.length,
    recovered: recoveredRows.length,
  });

  return (
    <CommitStatePage
      status={status}
      empty={
        <EmptyRows
          icon={UserIcon}
          title="No browser profile metadata"
          message="No Metadata rows in this Case, saved or recovered."
        />
      }
      figuresSkeleton={<FiguresSkeleton />}
      figures={
        <div className="flex flex-col gap-5">
          {browser === null ? null : <EnvironmentStrip browser={browser} />}
          <SectionPanel
            id="metadata-profiles"
            title="Profiles"
            count={
              profilesFiltered
                ? `${String(panelShown)} of ${String(panelTotal)}`
                : panelTotal
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
            {visibleProfiles.length === 0 && unread.length === 0 ? (
              <EmptyRows
                message={
                  profilesFiltered
                    ? "No profiles match this pick."
                    : "No saved profile-level metadata in this Case."
                }
                action={
                  profilesFiltered ? (
                    <Button
                      variant="tertiary"
                      size="compact"
                      onClick={clearProfiles}
                    >
                      Show every profile
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                {visibleProfiles.length === 0 ? null : (
                  <div className="border-t border-border p-1">
                    <CardGroup columns={columns}>
                      {visibleProfiles.map((row, index) => (
                        <ProfileCard
                          key={rowKey(row, index)}
                          row={row}
                          onSelect={sheet.select}
                        />
                      ))}
                    </CardGroup>
                  </div>
                )}
                <UnreadProfiles
                  profiles={unread}
                  completeness={caseContext?.completeness ?? null}
                />
              </>
            )}
          </SectionPanel>
        </div>
      }
      sheet={
        sheet.selected === null ? null : (
          <RowSheet
            selected={sheet.selected}
            title={
              sheet.selected.row.findingKind === "browser_metadata"
                ? "Browser metadata"
                : profileLabel(sheet.selected.row.profile)
            }
            onClose={sheet.close}
          />
        )
      }
    >
      <SectionPanel id="metadata-fields" title="Recorded fields">
        <CommitStateSplit
          value={view}
          onValueChange={setView}
          label="Saved or recovered metadata rows"
          {...status.split}
          toolbar={
            knownProfiles.length > 1 ? (
              <FilterField label="Profiles" htmlFor="metadata-fields-profiles">
                <ProfilePicker
                  id="metadata-fields-profiles"
                  profiles={knownProfiles}
                  selected={profileFilter}
                  onChange={setProfileFilter}
                />
              </FilterField>
            ) : null
          }
          saved={
            <FieldsList
              list={lists.saved}
              noun="saved"
              include={include}
              summarized={summarized}
              onSelect={sheet.select}
              onClearFilters={clearProfiles}
            />
          }
          recovered={
            <FieldsList
              list={lists.recovered}
              noun="recovered"
              include={include}
              summarized={EMPTY_SET}
              onSelect={sheet.select}
              onClearFilters={clearProfiles}
            />
          }
        />
      </SectionPanel>
    </CommitStatePage>
  );
}
