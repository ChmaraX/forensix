/**
 * One Sites host's rows per evidence kind: the columns an examiner reads
 * first for each kind (title over URL, cookie over path, file over source),
 * not a union of every wire field - every technical field stays reachable
 * through the row sheet. Within a kind, rows recovered from the WAL /
 * rollback journal are a separate list from saved rows (the stacked
 * CommitStateSplit, State column only there), never sorted in.
 */
import { useContext, useMemo } from "react";

import { Panel, PanelHeader, PanelTitle } from "@/components/panel";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { fieldLabel } from "../field-labels.js";
import type { SiteArtifactKind, SiteFinding } from "../types.js";
import { cacheResourceUrl } from "./cache-keys.js";
import { fileNameOf } from "./downloads-model.js";
import { DownloadState } from "./downloads-table.js";
import { FaviconBitmapsContext, ResolutionCell } from "./favicons-fields.js";
import {
  FieldCell,
  fieldInteger,
  fieldText,
  SiteAvatar,
  StateWord,
  TwoLineCell,
  profileLabel,
} from "./finding-fields.js";
import {
  CommitStateSplit,
  Count,
  formatBytes,
  IconTile,
  ResponsiveRows,
  type RowColumn,
  splitByCommit,
  TimeCell,
} from "./page-kit.js";
import { SITE_KINDS, siteKind, type SiteKindMeta } from "./site-kinds.js";

/** A row of a host's detail (`site-findings`): its kind and the fields
 *  that put it on the host. */
export type SiteRow = SiteFinding;

/** The row sheet's title: the singular of the row's kind (a download: its
 *  file name). */
export function sheetTitle(row: SiteRow): string {
  if (row.artifactKind === "downloads") {
    return fileNameOf(fieldText(row.fields.targetPath)) ?? "Download";
  }
  return siteKind(row.artifactKind).singular;
}

type KindColumn = RowColumn<SiteRow>;

const timeColumn = (
  key: string,
  header: string,
  field: string,
  stack: "lead" | "meta" = "meta",
): KindColumn => ({
  key,
  // Table times are UTC; the header says so (the card keeps the word).
  header: `${header} (UTC)`,
  label: header,
  className: "w-[184px] whitespace-nowrap",
  stack,
  labelled: stack === "meta",
  cell: (row) => <TimeCell field={row.fields[field]} />,
});

const stackedColumn = (
  header: string,
  primary: string,
  secondary: string,
  prose = false,
): KindColumn => ({
  key: "main",
  header,
  // Narrow enough that the Recovered list's State word still fits beside
  // the dates at 1440.
  className: "max-w-[320px] min-w-[180px]",
  stack: "title",
  cell: (row) => (
    <TwoLineCell
      primary={row.fields[primary]}
      secondary={row.fields[secondary]}
      mono={prose ? false : "auto"}
    />
  ),
});

/** "URL chain, Referrer": the fields that put the row on this host - meta,
 *  so a caption that wraps rather than cuts a field name off. */
const HOST_IN_COLUMN: KindColumn = {
  key: "host-in",
  header: "Host in",
  className: "w-[132px] min-w-[132px]",
  labelled: true,
  cell: (row) => <HostInCell row={row} />,
  stackedCell: (row) =>
    row.hostFields.map((name) => fieldLabel(name, row.findingKind)).join(", "),
};

function HostInCell({ row }: { readonly row: SiteRow }) {
  return (
    <span
      className={cn(
        typeClass("caption"),
        "flex flex-col text-muted-foreground",
      )}
    >
      {row.hostFields.map((name) => (
        <span key={name} className="whitespace-nowrap">
          {fieldLabel(name, row.findingKind)}
        </span>
      ))}
    </span>
  );
}

/** Received bytes, with the expected total beside them when the transfer
 *  stopped short ("9.4 MB of 28.2 MB"): never the total alone, which would
 *  overstate what arrived. */
function ReceivedCell({ row }: { readonly row: SiteRow }) {
  const received = fieldInteger(row.fields.receivedBytes);
  if (received === null) {
    return <FieldCell field={row.fields.receivedBytes} />;
  }
  const total = fieldInteger(row.fields.totalBytes);
  const short = total !== null && total > 0 && total !== received;
  return (
    <span
      className="whitespace-nowrap"
      title={
        short
          ? `${received.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} bytes received`
          : `${received.toLocaleString("en-US")} bytes received`
      }
    >
      {formatBytes(received)}
      {short ? (
        <span className="text-muted-foreground">{` of ${formatBytes(total)}`}</span>
      ) : null}
    </span>
  );
}

/** A favicon's own stored bitmap (when its bytes hash to the row's
 *  `payloadSha256`) beside its icon URL. */
function FaviconCell({ row }: { readonly row: SiteRow }) {
  const bitmaps = useContext(FaviconBitmapsContext);
  const sha = fieldText(row.fields.payloadSha256);
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <SiteAvatar
        host={null}
        src={sha === null ? null : (bitmaps.get(sha) ?? null)}
      />
      <span className="min-w-0 flex-1">
        <FieldCell field={row.fields.iconUrl} mono />
      </span>
    </span>
  );
}

/**
 * The columns per kind, chosen for reading, not completeness: the host is
 * already fixed by the selection, so cells carry what tells rows apart
 * within it. Below `sm` the time (or rank) leads each stacked row.
 */
const KIND_COLUMNS: Readonly<Record<SiteArtifactKind, readonly KindColumn[]>> =
  {
    visits: [
      timeColumn("time", "Time", "visitTime", "lead"),
      stackedColumn("Page", "title", "url", true),
    ],
    downloads: [
      {
        key: "file",
        header: "File",
        className: "max-w-[300px] min-w-[180px]",
        stack: "title",
        cell: (row) => {
          const name = fileNameOf(fieldText(row.fields.targetPath));
          return (
            <TwoLineCell
              primary={name ?? row.fields.targetPath}
              secondary={row.fields.originalUrl}
              mono={name === null ? "auto" : false}
            />
          );
        },
      },
      {
        key: "outcome",
        header: "Outcome",
        className: "w-[120px] whitespace-nowrap",
        stack: "aside",
        cell: (row) => <DownloadState field={row.fields.state} />,
      },
      {
        key: "received",
        header: "Received",
        className: "w-[150px] text-right whitespace-nowrap tabular-nums",
        labelled: true,
        cell: (row) => <ReceivedCell row={row} />,
      },
      timeColumn("started", "Started", "startTime", "lead"),
      HOST_IN_COLUMN,
    ],
    cookies: [
      stackedColumn("Cookie", "name", "path"),
      timeColumn("created", "Created", "creationTime", "lead"),
      timeColumn("expires", "Expires", "expiresTime"),
    ],
    saved_logins: [
      stackedColumn("Username", "usernameValue", "signonRealm"),
      timeColumn("created", "Created", "dateCreated"),
      timeColumn("last-used", "Last used", "dateLastUsed", "lead"),
    ],
    bookmarks: [
      stackedColumn("Bookmark", "name", "url", true),
      {
        key: "folder",
        header: "Folder",
        className: "max-w-[220px]",
        cell: (row) => <FieldCell field={row.fields.folderPath} mono={false} />,
      },
      timeColumn("added", "Added", "dateAdded", "lead"),
    ],
    top_sites: [
      {
        key: "rank",
        header: "Rank",
        className: "w-16 text-right tabular-nums",
        stack: "lead",
        cell: (row) => (
          <FieldCell
            field={row.fields.urlRank}
            format={(value) => String(value)}
          />
        ),
        stackedCell: (row) => (
          <FieldCell
            field={row.fields.urlRank}
            format={(value) => `Rank ${String(value)}`}
          />
        ),
      },
      stackedColumn("Site", "title", "url", true),
    ],
    favicons: [
      {
        key: "icon",
        header: "Icon",
        className: "max-w-[320px] min-w-[180px]",
        stack: "title",
        cell: (row) => <FaviconCell row={row} />,
      },
      {
        key: "resolution",
        header: "Resolution",
        className: "w-[104px] whitespace-nowrap tabular-nums",
        labelled: true,
        cell: (row) => <ResolutionCell row={row} />,
      },
      HOST_IN_COLUMN,
      timeColumn("updated", "Last updated", "lastUpdated", "lead"),
    ],
    cache: [
      {
        key: "resource",
        header: "Resource",
        className: "max-w-[420px] min-w-[200px]",
        stack: "title",
        cell: (row) => {
          // The key's resource URL (the scope prefix, if any, stays in the
          // row sheet's Key field).
          const url = cacheResourceUrl(fieldText(row.fields.key));
          return url === null ? (
            <FieldCell field={row.fields.key} mono />
          ) : (
            <span className="block truncate font-mono" title={url}>
              {url}
            </span>
          );
        },
      },
      {
        key: "size",
        header: "Size",
        className: "w-[96px] text-right whitespace-nowrap tabular-nums",
        labelled: true,
        cell: (row) => {
          const bytes =
            fieldInteger(row.fields.entrySizeBytes) ??
            fieldInteger(row.fields.stream1Size);
          return bytes === null ? (
            <FieldCell field={row.fields.entrySizeBytes} />
          ) : (
            <span title={`${bytes.toLocaleString("en-US")} bytes`}>
              {formatBytes(bytes)}
            </span>
          );
        },
      },
      timeColumn("last-used", "Last used", "lastUsed", "lead"),
    ],
  };

const PROFILE_COLUMN: KindColumn = {
  key: "profile",
  header: "Profile",
  className: "w-[136px] whitespace-nowrap",
  cell: (row) => profileLabel(row.profile),
};

const STATE_COLUMN: KindColumn = {
  key: "state",
  header: "State",
  stack: "aside",
  cell: (row) => <StateWord state={row.commitState} />,
};

/** Every column set a kind table can take, built once so the rows stay
 *  memoised (`ResponsiveRows` re-renders a row only when its props
 *  change). */
const COLUMN_SETS = new Map<string, readonly KindColumn[]>(
  SITE_KINDS.flatMap((meta) =>
    [false, true].flatMap((profile) =>
      [false, true].map((recovered): [string, readonly KindColumn[]] => [
        `${meta.kind}:${String(profile)}:${String(recovered)}`,
        [
          ...KIND_COLUMNS[meta.kind],
          ...(profile ? [PROFILE_COLUMN] : []),
          ...(recovered ? [STATE_COLUMN] : []),
        ],
      ]),
    ),
  ),
);

const kindRowKey = (row: SiteRow, index: number) =>
  `${row.commitState}:${row.profile}:${row.provenance.table ?? ""}:${row.provenance.rowId ?? ""}:${String(index)}`;

/** The recorded value a row is read by, per kind (its accessible name). */
const ROW_NAME_FIELDS: Readonly<Record<SiteArtifactKind, readonly string[]>> = {
  visits: ["title", "url"],
  downloads: [],
  cookies: ["name"],
  saved_logins: ["usernameValue", "signonRealm"],
  bookmarks: ["name", "url"],
  top_sites: ["title", "url"],
  favicons: ["iconUrl"],
  cache: ["key"],
};

/** "Open download detail: teamviewer_setup.exe". */
function rowLabelOf(meta: SiteKindMeta): (row: SiteRow) => string {
  return (row) => {
    const name =
      meta.kind === "downloads"
        ? fileNameOf(fieldText(row.fields.targetPath))
        : meta.kind === "cache"
          ? cacheResourceUrl(fieldText(row.fields.key))
          : (ROW_NAME_FIELDS[meta.kind]
              .map((field) => fieldText(row.fields[field]))
              .find((text) => text !== null) ?? null);
    return `Open ${meta.one} detail${name === null ? "" : `: ${name}`}`;
  };
}

const KIND_ROW_LABELS = new Map<SiteArtifactKind, (row: SiteRow) => string>(
  SITE_KINDS.map((meta) => [meta.kind, rowLabelOf(meta)]),
);

function KindTable({
  kind,
  rows,
  recovered,
  showProfile,
  onSelect,
}: {
  readonly kind: SiteArtifactKind;
  readonly rows: readonly SiteRow[];
  /** The recovered list: adds the State column. */
  readonly recovered: boolean;
  /** The host's rows span more than one profile: adds the Profile column. */
  readonly showProfile: boolean;
  readonly onSelect: (row: SiteRow) => void;
}) {
  return (
    <ResponsiveRows
      rows={rows}
      columns={
        COLUMN_SETS.get(
          `${kind}:${String(showProfile)}:${String(recovered)}`,
        ) ?? KIND_COLUMNS[kind]
      }
      rowKey={kindRowKey}
      rowLabel={KIND_ROW_LABELS.get(kind)}
      onSelect={onSelect}
      tableClassName="tabular-nums"
    />
  );
}

/**
 * One evidence kind for the selected host: its saved rows, then - as a
 * separate list with its own heading - any rows recovered from a sidecar.
 */
export function KindPanel({
  meta,
  rows,
  onSelect,
}: {
  readonly meta: SiteKindMeta;
  readonly rows: readonly SiteRow[];
  readonly onSelect: (row: SiteRow) => void;
}) {
  const { saved, recovered } = useMemo(() => splitByCommit(rows), [rows]);
  // The Profile column only when this kind's rows span more than one.
  const showProfile = new Set(rows.map((row) => row.profile)).size > 1;
  const titleId = `sites-kind-${meta.kind}`;
  return (
    <Panel role="region" aria-labelledby={titleId} className="overflow-clip">
      <PanelHeader className="items-center pb-2">
        <div className="flex items-center gap-3">
          <IconTile icon={meta.icon} />
          {/* Under the host's h2: a third-level heading. */}
          <PanelTitle id={titleId} as="h3">
            {meta.label}
          </PanelTitle>
          <Count>{saved.length}</Count>
        </div>
      </PanelHeader>
      <CommitStateSplit
        variant="stacked"
        headingAs="h4"
        savedCount={saved.length}
        recoveredCount={recovered.length}
        saved={
          saved.length > 0 ? (
            <KindTable
              kind={meta.kind}
              rows={saved}
              recovered={false}
              showProfile={showProfile}
              onSelect={onSelect}
            />
          ) : (
            // Recovered rows only: one line, not a full empty state, so
            // the recovered list below stays the panel's content.
            <p
              className={cn(
                typeClass("body"),
                "px-4 pb-3 text-muted-foreground",
              )}
            >
              {`No saved ${meta.many} for this host.`}
            </p>
          )
        }
        recovered={
          <KindTable
            kind={meta.kind}
            rows={recovered}
            recovered
            showProfile={showProfile}
            onSelect={onSelect}
          />
        }
      />
    </Panel>
  );
}
