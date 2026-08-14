import type {
  BookmarksArtifactWrite,
  BookmarkSourceFile,
  PersistedBookmarkFinding,
} from "./case-findings.js";
import type { CaseSourceRecord } from "./case.js";
import {
  absentField,
  createFinding,
  unavailableField,
  valueField,
  type FieldState,
  type Finding,
  type Provenance,
} from "./forensic-model.js";
import type { ForensicTimestamp } from "./history.js";
import { readVerifiedJsonFile, resolveJsonFile } from "./working-copy-json.js";
import {
  WINDOWS_EPOCH_OFFSET_MICROS,
  utcFromUnixMicros,
} from "./forensic-time.js";

/**
 * Chrome stores Bookmarks as a JSON document (not SQLite). Every Profile has a
 * primary `Bookmarks` file and Chrome writes a `Bookmarks.bak` snapshot of the
 * previous on-disk state whenever it rewrites the primary. The two files are
 * separate evidence: this module parses each into its own artifact so the
 * primary and backup records keep distinct Provenance and are never merged.
 */

export const BOOKMARK_KIND = "bookmark";

/**
 * Chrome writes every Bookmarks date field as microseconds since 1601-01-01 UTC
 * (the WebKit / `base::Time` internal epoch), rendered as a decimal string, on
 * every platform. The epoch is fixed, so no Declared Origin OS is required to
 * resolve it.
 */
const BOOKMARKS_EPOCH_FAMILY = "1601-us" as const;

/** The two Bookmarks evidence files, in their canonical relative filenames. */
const BOOKMARK_SOURCE_FILES = [
  "Bookmarks",
  "Bookmarks.bak",
] as const satisfies readonly BookmarkSourceFile[];

/** The conventional Chrome bookmark roots, walked first for stable ordering. */
const PREFERRED_ROOT_KEYS = ["bookmark_bar", "other", "synced"] as const;

interface ManifestIdentity {
  readonly sourceId: string;
  readonly ordinal: number;
  readonly path: string;
}

interface WalkContext {
  readonly profile: string;
  readonly sourceFile: BookmarkSourceFile;
  readonly manifest: ManifestIdentity;
  readonly declaredTimezone: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A Bookmarks string field. A missing or explicitly `null` value is `absent`; a
 * present value of the wrong type is `unavailable` with a typed reason so a
 * malformed entry is never mistaken for a removed one.
 */
function stringField(value: unknown): FieldState<string> {
  if (value === undefined || value === null) {
    return absentField();
  }
  return typeof value === "string"
    ? valueField(value)
    : unavailableField("unsupported_value");
}

/**
 * Resolve a Bookmarks WebKit-epoch date field. A missing value or the Chrome
 * "never" sentinel `"0"` is `absent`; a non-numeric-string value is
 * `unavailable`; an out-of-range instant is `unavailable`. A resolved value
 * keeps the exact raw string, the fixed epoch family, and the derived UTC.
 */
function timestampField(
  value: unknown,
  declaredTimezone: string,
): FieldState<ForensicTimestamp> {
  if (value === undefined || value === null) {
    return absentField();
  }
  if (typeof value !== "string" || !/^-?[0-9]+$/.test(value)) {
    return unavailableField("unsupported_value");
  }
  const micros = BigInt(value);
  if (micros === 0n) {
    return absentField();
  }
  const utc = utcFromUnixMicros(micros - WINDOWS_EPOCH_OFFSET_MICROS);
  if (utc === null) {
    return unavailableField("timestamp_out_of_range");
  }
  return valueField(
    {
      raw: value,
      epochFamily: BOOKMARKS_EPOCH_FAMILY,
      utc,
      declaredTimezone,
      resolution: "webkit_bookmarks_epoch",
    },
    { synthetic: false },
  );
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return typeof value === "number" && Number.isInteger(value)
    ? value.toString()
    : undefined;
}

function buildBookmark(options: {
  readonly node: Record<string, unknown>;
  readonly ancestry: readonly string[];
  readonly rootKey: string;
  readonly context: WalkContext;
  readonly index: number;
}): PersistedBookmarkFinding {
  const { node, ancestry, rootKey, context } = options;
  const id = optionalString(node.id);
  const guid = optionalString(node.guid);
  const rowId = id ?? guid ?? `${context.sourceFile}#${options.index}`;

  const provenance: Provenance = {
    manifestEntryId: `${context.manifest.sourceId}:${context.manifest.ordinal}`,
    sourceId: context.manifest.sourceId,
    manifestEntryOrdinal: context.manifest.ordinal,
    manifestPath: context.manifest.path,
    database: context.manifest.path,
    table: "bookmarks",
    rowId,
  };

  const name = stringField(node.name);
  const url = stringField(node.url);
  const dateAdded = timestampField(node.date_added, context.declaredTimezone);
  const dateLastUsed = timestampField(
    node.date_last_used,
    context.declaredTimezone,
  );
  const folderPath = ancestry.join(" / ");
  const parentFolder =
    ancestry.length > 0
      ? valueField(ancestry[ancestry.length - 1] as string)
      : absentField();

  const fields = {
    bookmarkId: id === undefined ? absentField() : valueField(id),
    guid: guid === undefined ? absentField() : valueField(guid),
    name,
    url,
    dateAdded,
    dateLastUsed,
    sourceFile: valueField(context.sourceFile),
    rootFolder: valueField(rootKey),
    parentFolder,
    folderPath: valueField(folderPath, { synthetic: true }),
  };

  const finding: Finding = createFinding({
    findingKind: BOOKMARK_KIND,
    profile: context.profile,
    commitState: "committed",
    provenance,
    fields,
  });

  const nameValue = name.state === "value" ? name.value : null;
  const urlValue = url.state === "value" ? url.value : null;
  return {
    finding,
    searchText: [
      context.profile,
      nameValue ?? "",
      urlValue ?? "",
      folderPath,
      context.sourceFile,
    ]
      .join("\n")
      .toLocaleLowerCase("en-US"),
    sourceFile: context.sourceFile,
    sortName: nameValue,
    sortUrl: urlValue,
    sortDateAdded:
      dateAdded.state === "value" ? BigInt(dateAdded.value.raw) : null,
    sortFolder: folderPath,
  };
}

/**
 * Depth-first walk of a Bookmarks node tree. A `folder` node contributes its
 * name to the ancestry and recurses into its children; a `url` node yields one
 * Finding carrying the full folder ancestry from the containing root. A node of
 * an unknown type, or a non-object child, is skipped so that one corrupt entry
 * never discards the rest of an otherwise defensible tree.
 */
function walkNode(options: {
  readonly node: unknown;
  readonly ancestry: readonly string[];
  readonly rootKey: string;
  readonly context: WalkContext;
  readonly counter: { value: number };
  readonly out: PersistedBookmarkFinding[];
}): void {
  const { node, ancestry, rootKey, context, counter, out } = options;
  if (!isObject(node)) {
    return;
  }
  if (node.type === "folder") {
    const folderName =
      typeof node.name === "string" && node.name.length > 0
        ? node.name
        : rootKey;
    const childAncestry = [...ancestry, folderName];
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walkNode({
          node: child,
          ancestry: childAncestry,
          rootKey,
          context,
          counter,
          out,
        });
      }
    }
    return;
  }
  if (node.type === "url") {
    counter.value += 1;
    out.push(
      buildBookmark({
        node,
        ancestry,
        rootKey,
        context,
        index: counter.value,
      }),
    );
  }
}

type DocumentParse =
  | { readonly kind: "ok"; readonly findings: PersistedBookmarkFinding[] }
  | { readonly kind: "unsupported"; readonly reason: string };

/**
 * Parse a top-level Bookmarks document. A document that parsed as JSON but has
 * no `roots` object is structurally unsupported (typed `unavailable`), distinct
 * from a byte-level parse failure. The returned reason is a bare suffix; the
 * caller prefixes it with the per-file label so primary and backup stay
 * distinguishable by reason string. Roots are walked in the conventional
 * `bookmark_bar`, `other`, `synced` order first, then any remaining roots in
 * sorted order, so Finding ordering is deterministic across runs.
 */
function parseDocument(document: unknown, context: WalkContext): DocumentParse {
  if (!isObject(document) || !isObject(document.roots)) {
    return { kind: "unsupported", reason: "unsupported_shape" };
  }
  const roots = document.roots;
  const remaining = Object.keys(roots)
    .filter((key) => !PREFERRED_ROOT_KEYS.includes(key as never))
    .sort();
  const orderedKeys = [
    ...PREFERRED_ROOT_KEYS.filter((key) => Object.hasOwn(roots, key)),
    ...remaining,
  ];
  const out: PersistedBookmarkFinding[] = [];
  const counter = { value: 0 };
  for (const key of orderedKeys) {
    walkNode({
      node: roots[key],
      ancestry: [],
      rootKey: key,
      context,
      counter,
      out,
    });
  }
  return { kind: "ok", findings: out };
}

function unavailableArtifact(options: {
  readonly sourceId: string;
  readonly profile: string;
  readonly sourceFile: BookmarkSourceFile;
  readonly databasePath: string;
  readonly ordinal: number | null;
  readonly status: "absent" | "unavailable";
  readonly reason: string;
}): BookmarksArtifactWrite {
  return {
    sourceId: options.sourceId,
    profile: options.profile,
    artifact: options.sourceFile,
    status: options.status,
    manifestEntryOrdinal: options.ordinal,
    databasePath: options.databasePath,
    reason: options.reason,
    findings: [],
    bookmarkCount: 0,
  };
}

async function analyseBookmarkFile(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
  readonly declaredTimezone: string;
  readonly sourceFile: BookmarkSourceFile;
}): Promise<BookmarksArtifactWrite> {
  const { source, profile, sourceFile } = options;
  const databasePath =
    profile === "." ? sourceFile : `${profile}/${sourceFile}`;
  const label = sourceFile === "Bookmarks" ? "bookmarks" : "bookmarks_backup";
  const resolution = resolveJsonFile(
    source,
    options.workingCopyPath,
    databasePath,
    label,
  );
  if (resolution.kind !== "ready") {
    return unavailableArtifact({
      sourceId: source.sourceId,
      profile,
      sourceFile,
      databasePath,
      ordinal: resolution.ordinal,
      status: resolution.kind,
      reason: resolution.reason,
    });
  }

  const read = await readVerifiedJsonFile(resolution.file);
  if (read.status !== "parsed") {
    return unavailableArtifact({
      sourceId: source.sourceId,
      profile,
      sourceFile,
      databasePath,
      ordinal: resolution.ordinal,
      status: "unavailable",
      reason: `${label}_${read.reason}`,
    });
  }

  const context: WalkContext = {
    profile,
    sourceFile,
    manifest: {
      sourceId: source.sourceId,
      ordinal: resolution.ordinal,
      path: databasePath,
    },
    declaredTimezone: options.declaredTimezone,
  };
  const parsed = parseDocument(read.value, context);
  if (parsed.kind === "unsupported") {
    return unavailableArtifact({
      sourceId: source.sourceId,
      profile,
      sourceFile,
      databasePath,
      ordinal: resolution.ordinal,
      status: "unavailable",
      reason: `${label}_${parsed.reason}`,
    });
  }

  return {
    sourceId: source.sourceId,
    profile,
    artifact: sourceFile,
    status: "complete",
    manifestEntryOrdinal: resolution.ordinal,
    databasePath,
    reason: null,
    findings: parsed.findings,
    bookmarkCount: parsed.findings.length,
  };
}

export interface BookmarksAnalysisInput {
  readonly source: CaseSourceRecord;
  readonly workingCopyPath: string;
  readonly declaredTimezone: string;
}

/**
 * Parse the primary `Bookmarks` and backup `Bookmarks.bak` documents for every
 * Profile into bookmark Findings. Each Profile yields two artifacts, one per
 * file, so primary and backup evidence stays independently addressable: a
 * missing expected file is `absent`, a byte-intact but malformed document is a
 * typed `unavailable`, and the two never collapse into one record.
 */
export async function analyseSourceBookmarks(
  input: BookmarksAnalysisInput,
): Promise<BookmarksArtifactWrite[]> {
  const artifacts: BookmarksArtifactWrite[] = [];
  for (const profile of input.source.profiles) {
    for (const sourceFile of BOOKMARK_SOURCE_FILES) {
      artifacts.push(
        await analyseBookmarkFile({
          source: input.source,
          profile: profile.path,
          workingCopyPath: input.workingCopyPath,
          declaredTimezone: input.declaredTimezone,
          sourceFile,
        }),
      );
    }
  }
  return artifacts;
}

export type { Finding as BookmarkFinding };
