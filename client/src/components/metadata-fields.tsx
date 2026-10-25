/**
 * The Browser profile page's "Recorded fields": every curated field of each
 * Metadata row, one row after another, each fact once - a saved row the
 * strip or a card already shows lists only what they do not. Saved and
 * recovered rows are separate lists; the detail sheet keeps every wire
 * field.
 */
import { Button } from "@/components/ui/button";
import { BrowserIcon, UserIcon, type AppIcon } from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { Finding } from "../types.js";
import type {
  PaginatedList,
  RecoveredList,
} from "../use-commit-state-lists.js";
import { EmptyRows } from "./data-table.js";
import { MaybeFieldStateText } from "./field-state.js";
import { fieldString, StateWord } from "./finding-fields.js";
import { ListBlock } from "./list-states.js";
import {
  exitReading,
  KEY_FIELDS,
  KeyPresence,
  postureOf,
  rowHeadline,
} from "./metadata-readings.js";
import { Term } from "./term.js";

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
  { key: "profileCount", label: "Profiles in Local State" },
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
export function rowKey(row: Finding, index: number): string {
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
        {/* As on the profile card: the account's own name, when
            recorded, under the profile's one name. */}
        {browserRow || fieldString(row.fields.accountFullName) !== null ? (
          <span className={cn(typeClass("caption"), "text-muted-foreground")}>
            {browserRow ? "Browser" : fieldString(row.fields.accountFullName)}
          </span>
        ) : null}
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
export const EMPTY_SET: ReadonlySet<Finding> = new Set();

/**
 * One list (saved or recovered) of recorded fields: its loading rows, its
 * read error, its empty state, every row of the picked profiles stacked
 * (the browser-level row always), a load-more failure (Retry asks for that
 * page again and keeps the loaded rows), and the "N shown / Load more"
 * footer.
 */
export function FieldsList({
  list,
  noun,
  include,
  summarized,
  onSelect,
  onClearFilters,
}: {
  readonly list: PaginatedList<Finding> | RecoveredList<Finding>;
  readonly noun: "saved" | "recovered";
  /** The profile pick: which rows the list shows. */
  readonly include: (row: Finding) => boolean;
  /** Rows the panels above already show (their facts are not repeated). */
  readonly summarized: ReadonlySet<Finding>;
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
}) {
  const shown = list.rows.flatMap((row, index) =>
    include(row) ? [{ key: rowKey(row, index), row }] : [],
  );
  return (
    <ListBlock
      list={list}
      noun={{ one: `${noun} metadata row`, many: `${noun} metadata rows` }}
      shown={shown.length}
      onClearFilters={onClearFilters}
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
