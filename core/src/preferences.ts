import type {
  MetadataArtifactWrite,
  PersistedMetadataFinding,
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
  type SourceRowProvenance,
} from "./forensic-model.js";
import { readVerifiedJsonFile, resolveJsonFile } from "./preferences-json.js";

export const BROWSER_METADATA_KIND = "browser_metadata";
export const PROFILE_METADATA_KIND = "profile_metadata";

/**
 * Chrome writes profile and browser metadata as JSON, not SQLite. A `Local
 * State` document is browser-level (one per User Data Dir); a `Preferences`
 * document is Profile-level (one per Profile). This module keeps those two
 * scopes distinct even though the browser file also holds a per-Profile
 * `profile.info_cache` slice: the slice is Profile-scoped data that merely lives
 * in a browser-level file, so it is attached to the owning Profile Finding as a
 * supporting Provenance row.
 */

export type Lookup =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "absent" }
  | { readonly kind: "malformed" };

/**
 * Navigate a JSON document by key path. A missing key or an explicit `null`
 * (Chrome's cleared-value convention) is `absent`; a non-object encountered
 * mid-path is `malformed`. This is what lets removed or inapplicable keys stay
 * absent while a wrong-shaped document surfaces as unavailable.
 */
export function lookup(root: unknown, keys: readonly string[]): Lookup {
  let current: unknown = root;
  for (const key of keys) {
    if (current === undefined || current === null) {
      return { kind: "absent" };
    }
    if (typeof current !== "object" || Array.isArray(current)) {
      return { kind: "malformed" };
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (current === undefined || current === null) {
    return { kind: "absent" };
  }
  return { kind: "value", value: current };
}

export function stringField(result: Lookup): FieldState<string> {
  if (result.kind === "absent") {
    return absentField();
  }
  if (result.kind === "malformed") {
    return unavailableField("unsupported_value");
  }
  return typeof result.value === "string"
    ? valueField(result.value)
    : unavailableField("unsupported_value");
}

export function integerField(result: Lookup): FieldState<string> {
  if (result.kind === "absent") {
    return absentField();
  }
  if (result.kind === "malformed") {
    return unavailableField("unsupported_value");
  }
  return typeof result.value === "number" && Number.isInteger(result.value)
    ? valueField(result.value.toString())
    : unavailableField("unsupported_value");
}

function booleanField(result: Lookup): FieldState<boolean> {
  if (result.kind === "absent") {
    return absentField();
  }
  if (result.kind === "malformed") {
    return unavailableField("unsupported_value");
  }
  return typeof result.value === "boolean"
    ? valueField(result.value)
    : unavailableField("unsupported_value");
}

/**
 * The browser-level Chrome version recorded in the current `Local State` schema
 * as the first element of `variations_permanent_consistency_country`
 * (`[version, country]`). A present-but-wrong shape is unavailable, never blank.
 *
 * Caveat for examiners: this element is the version at which the variations
 * consistency country was last persisted, not necessarily the currently
 * installed or last-run build. `Local State` has no dedicated version key, so
 * this is the best in-file proxy; the Provenance points at the exact source.
 */
export function chromeVersionField(localState: unknown): FieldState<string> {
  const result = lookup(localState, [
    "variations_permanent_consistency_country",
  ]);
  if (result.kind === "absent") {
    return absentField();
  }
  if (result.kind === "malformed" || !Array.isArray(result.value)) {
    return unavailableField("unsupported_value");
  }
  const version = result.value[0];
  return typeof version === "string" && version.length > 0
    ? valueField(version)
    : unavailableField("unsupported_value");
}

function arrayLengthField(result: Lookup): FieldState<string> {
  if (result.kind === "absent") {
    return absentField();
  }
  if (result.kind === "malformed" || !Array.isArray(result.value)) {
    return unavailableField("unsupported_value");
  }
  return valueField(result.value.length.toString());
}

/**
 * Presence-only classification of an OSCrypt key blob. The key material itself
 * is never disclosed here; only whether the current `Local State` schema records
 * a string value at the given path.
 */
function presenceField(
  localState: unknown,
  keys: readonly string[],
): FieldState<boolean> {
  const result = lookup(localState, keys);
  if (result.kind === "value") {
    return valueField(typeof result.value === "string");
  }
  return booleanField(result);
}

/**
 * A synthetic `WxH` string for the Profile window-placement work area. This is
 * the display work area Chrome records (it excludes OS chrome such as a taskbar
 * or dock), not the full physical screen resolution, so it is named for the work
 * area and always marked `synthetic` so an examiner never mistakes a derived
 * value for a stored one.
 */
export function screenWorkAreaField(
  left: FieldState<string>,
  top: FieldState<string>,
  right: FieldState<string>,
  bottom: FieldState<string>,
): FieldState<string> {
  const bounds = [left, top, right, bottom];
  if (bounds.some((bound) => bound.state === "unavailable")) {
    return unavailableField("unsupported_value");
  }
  if (bounds.some((bound) => bound.state === "absent")) {
    return absentField();
  }
  const numbers = bounds.map((bound) =>
    Number((bound as { readonly value: string }).value),
  );
  const [l, t, r, b] = numbers as [number, number, number, number];
  const width = r - l;
  const height = b - t;
  if (width <= 0 || height <= 0) {
    return unavailableField("unsupported_value");
  }
  return valueField(`${width}x${height}`, { synthetic: true });
}

/**
 * Resolve the primary account from `account_info` plus the total account count.
 * Only the first entry (`account_info[0]`) is detailed; a Profile signed into
 * multiple accounts reports the rest only through `count`, so the per-account
 * fields describe the primary account and `accountCount` bounds the remainder.
 */
function firstAccount(preferences: unknown): {
  readonly count: FieldState<string>;
  readonly account: unknown;
} {
  const result = lookup(preferences, ["account_info"]);
  const count = arrayLengthField(result);
  if (
    result.kind === "value" &&
    Array.isArray(result.value) &&
    result.value.length > 0
  ) {
    return { count, account: result.value[0] ?? null };
  }
  return { count, account: null };
}

function unavailableArtifact(
  sourceId: string,
  profile: string,
  artifact: "Local State" | "Preferences",
  databasePath: string,
  ordinal: number | null,
  status: "absent" | "unavailable",
  reason: string,
): MetadataArtifactWrite {
  return {
    sourceId,
    profile,
    artifact,
    status,
    manifestEntryOrdinal: ordinal,
    databasePath,
    reason,
    findings: [],
  };
}

function browserProvenance(sourceId: string, ordinal: number): Provenance {
  return {
    manifestEntryId: `${sourceId}:${ordinal}`,
    sourceId,
    manifestEntryOrdinal: ordinal,
    manifestPath: "Local State",
    database: "Local State",
    table: "local_state",
    rowId: "local_state",
  };
}

function textValue(field: FieldState<string>): string {
  return field.state === "value" ? field.value : "";
}

function buildBrowserFinding(options: {
  readonly sourceId: string;
  readonly profile: string;
  readonly ordinal: number;
  readonly localState: unknown;
}): PersistedMetadataFinding {
  const chromeVersion = chromeVersionField(options.localState);
  const lastUsedProfile = stringField(
    lookup(options.localState, ["profile", "last_used"]),
  );
  const variationsCountry = stringField(
    lookup(options.localState, ["variations_country"]),
  );
  const fields = {
    scope: valueField("browser"),
    chromeVersion,
    variationsCountry,
    lastUsedProfile,
    profileCount: arrayLengthField(
      lookup(options.localState, ["profile", "profiles_order"]),
    ),
    osCryptKeyPresent: presenceField(options.localState, [
      "os_crypt",
      "encrypted_key",
    ]),
    osCryptAppBoundKeyPresent: presenceField(options.localState, [
      "os_crypt",
      "app_bound_encrypted_key",
    ]),
  };
  const finding: Finding = createFinding({
    findingKind: BROWSER_METADATA_KIND,
    profile: options.profile,
    commitState: "committed",
    provenance: browserProvenance(options.sourceId, options.ordinal),
    fields,
  });
  return {
    finding,
    searchText: [
      "browser",
      textValue(chromeVersion),
      textValue(variationsCountry),
      textValue(lastUsedProfile),
    ]
      .join("\n")
      .toLocaleLowerCase("en-US"),
    sortType: BROWSER_METADATA_KIND,
    sortProfile: options.profile,
  };
}

function buildProfileFinding(options: {
  readonly sourceId: string;
  readonly profile: string;
  readonly ordinal: number;
  readonly preferences: unknown;
  readonly localState: unknown;
  readonly localStateOrdinal: number | null;
  readonly preferencesPath: string;
}): PersistedMetadataFinding {
  const profileName = stringField(
    lookup(options.preferences, ["profile", "name"]),
  );
  const createdByVersion = stringField(
    lookup(options.preferences, ["profile", "created_by_version"]),
  );
  const exitType = stringField(
    lookup(options.preferences, ["profile", "exit_type"]),
  );
  const { count: accountCount, account } = firstAccount(options.preferences);
  const accountEmail = stringField(lookup(account, ["email"]));
  const accountGaiaId = stringField(lookup(account, ["gaia"]));
  const accountFullName = stringField(lookup(account, ["full_name"]));
  const accountGivenName = stringField(lookup(account, ["given_name"]));
  const accountLocale = stringField(lookup(account, ["locale"]));
  const accountHostedDomain = stringField(lookup(account, ["hd"]));

  const placement = [
    "work_area_left",
    "work_area_top",
    "work_area_right",
    "work_area_bottom",
  ].map((key) =>
    integerField(
      lookup(options.preferences, ["browser", "window_placement", key]),
    ),
  );
  const [workAreaLeft, workAreaTop, workAreaRight, workAreaBottom] =
    placement as [
      FieldState<string>,
      FieldState<string>,
      FieldState<string>,
      FieldState<string>,
    ];
  const screenWorkArea = screenWorkAreaField(
    workAreaLeft,
    workAreaTop,
    workAreaRight,
    workAreaBottom,
  );

  // Profile-scoped demographics and avatar data live in the browser-level
  // Local State `profile.info_cache` slice keyed by Profile directory. When the
  // browser file could not be read they are unavailable (the related row is
  // missing), never silently absent.
  const infoCacheAvailable =
    options.localStateOrdinal !== null && options.localState !== null;
  const profileDir = options.profile === "." ? null : options.profile;
  const sliceKeys =
    profileDir === null ? null : ["profile", "info_cache", profileDir];

  function infoCacheField(
    key: string,
    builder: (result: Lookup) => FieldState<unknown>,
  ): FieldState<unknown> {
    if (!infoCacheAvailable) {
      return unavailableField("related_row_missing");
    }
    if (sliceKeys === null) {
      return absentField();
    }
    return builder(lookup(options.localState, [...sliceKeys, key]));
  }

  const avatarIcon = infoCacheField("avatar_icon", stringField);
  const gaiaName = infoCacheField("gaia_name", stringField);
  const gaiaGivenName = infoCacheField("gaia_given_name", stringField);
  const gaiaId = infoCacheField("gaia_id", stringField);
  const gaiaPictureFileName = infoCacheField(
    "gaia_picture_file_name",
    stringField,
  );
  const infoCacheUserName = infoCacheField("user_name", stringField);
  const isUsingDefaultAvatar = infoCacheField(
    "is_using_default_avatar",
    booleanField,
  );
  const isUsingDefaultName = infoCacheField(
    "is_using_default_name",
    booleanField,
  );

  // A supporting Provenance row is attached only when the browser `info_cache`
  // slice was actually consulted for this Finding: the file was readable and a
  // Profile directory key exists to locate the slice. A single-Profile Source
  // (`profile === "."`) has no directory key, so its info_cache fields are
  // absent and no supporting row is claimed — Provenance never asserts a source
  // that did not contribute.
  const supportingRows: SourceRowProvenance[] =
    infoCacheAvailable &&
    options.localStateOrdinal !== null &&
    profileDir !== null
      ? [
          {
            manifestEntryId: `${options.sourceId}:${options.localStateOrdinal}`,
            sourceId: options.sourceId,
            manifestEntryOrdinal: options.localStateOrdinal,
            manifestPath: "Local State",
            database: "Local State",
            table: "local_state",
            rowId: `profile.info_cache/${profileDir}`,
          },
        ]
      : [];

  const provenance: Provenance = {
    manifestEntryId: `${options.sourceId}:${options.ordinal}`,
    sourceId: options.sourceId,
    manifestEntryOrdinal: options.ordinal,
    manifestPath: options.preferencesPath,
    database: options.preferencesPath,
    table: "preferences",
    rowId: options.profile,
    ...(supportingRows.length > 0 ? { supportingRows } : {}),
  };

  const fields = {
    scope: valueField("profile"),
    profileName,
    createdByVersion,
    exitType,
    accountCount,
    accountEmail,
    accountGaiaId,
    accountFullName,
    accountGivenName,
    accountLocale,
    accountHostedDomain,
    workAreaLeft,
    workAreaTop,
    workAreaRight,
    workAreaBottom,
    screenWorkArea,
    avatarIcon,
    gaiaName,
    gaiaGivenName,
    gaiaId,
    gaiaPictureFileName,
    infoCacheUserName,
    isUsingDefaultAvatar,
    isUsingDefaultName,
  };

  const finding: Finding = createFinding({
    findingKind: PROFILE_METADATA_KIND,
    profile: options.profile,
    commitState: "committed",
    provenance,
    fields,
  });

  return {
    finding,
    searchText: [
      options.profile,
      textValue(profileName),
      textValue(accountEmail),
      avatarIcon.state === "value" ? String(avatarIcon.value) : "",
      gaiaName.state === "value" ? String(gaiaName.value) : "",
    ]
      .join("\n")
      .toLocaleLowerCase("en-US"),
    sortType: PROFILE_METADATA_KIND,
    sortProfile: options.profile,
  };
}

export interface PreferencesAnalysisInput {
  readonly source: CaseSourceRecord;
  readonly workingCopyPath: string;
}

/**
 * Parse browser-level `Local State` and each Profile's `Preferences` into
 * metadata Findings. Emits one browser-scoped artifact per Source plus one
 * Profile-scoped artifact per Profile. Byte drift from the recorded Manifest is
 * an integrity refusal and propagates; a malformed or unreadable document is a
 * typed `unavailable` artifact so the rest of the Case stays queryable.
 */
export async function analyseSourcePreferences(
  input: PreferencesAnalysisInput,
): Promise<MetadataArtifactWrite[]> {
  const { source, workingCopyPath } = input;
  const artifacts: MetadataArtifactWrite[] = [];

  // Browser-level Local State, read once and reused by every Profile.
  const localStateResolution = resolveJsonFile(
    source,
    workingCopyPath,
    "Local State",
    "local_state",
  );
  let localStateValue: unknown = null;
  let localStateOrdinal: number | null = null;
  if (localStateResolution.kind === "ready") {
    const read = await readVerifiedJsonFile(localStateResolution.file);
    if (read.status === "parsed") {
      localStateValue = read.value;
      localStateOrdinal = localStateResolution.ordinal;
      artifacts.push({
        sourceId: source.sourceId,
        profile: ".",
        artifact: "Local State",
        status: "complete",
        manifestEntryOrdinal: localStateResolution.ordinal,
        databasePath: "Local State",
        reason: null,
        findings: [
          buildBrowserFinding({
            sourceId: source.sourceId,
            profile: ".",
            ordinal: localStateResolution.ordinal,
            localState: read.value,
          }),
        ],
      });
    } else {
      artifacts.push(
        unavailableArtifact(
          source.sourceId,
          ".",
          "Local State",
          "Local State",
          localStateResolution.ordinal,
          "unavailable",
          `local_state_${read.reason}`,
        ),
      );
    }
  } else {
    artifacts.push(
      unavailableArtifact(
        source.sourceId,
        ".",
        "Local State",
        "Local State",
        localStateResolution.ordinal,
        localStateResolution.kind,
        localStateResolution.reason,
      ),
    );
  }

  // Profile-level Preferences, one artifact per Profile.
  for (const profile of source.profiles) {
    const preferencesPath =
      profile.path === "." ? "Preferences" : `${profile.path}/Preferences`;
    const resolution = resolveJsonFile(
      source,
      workingCopyPath,
      preferencesPath,
      "preferences",
    );
    if (resolution.kind !== "ready") {
      artifacts.push(
        unavailableArtifact(
          source.sourceId,
          profile.path,
          "Preferences",
          preferencesPath,
          resolution.ordinal,
          resolution.kind,
          resolution.reason,
        ),
      );
      continue;
    }
    const read = await readVerifiedJsonFile(resolution.file);
    if (read.status !== "parsed") {
      artifacts.push(
        unavailableArtifact(
          source.sourceId,
          profile.path,
          "Preferences",
          preferencesPath,
          resolution.ordinal,
          "unavailable",
          `preferences_${read.reason}`,
        ),
      );
      continue;
    }
    artifacts.push({
      sourceId: source.sourceId,
      profile: profile.path,
      artifact: "Preferences",
      status: "complete",
      manifestEntryOrdinal: resolution.ordinal,
      databasePath: preferencesPath,
      reason: null,
      findings: [
        buildProfileFinding({
          sourceId: source.sourceId,
          profile: profile.path,
          ordinal: resolution.ordinal,
          preferences: read.value,
          localState: localStateValue,
          localStateOrdinal,
          preferencesPath,
        }),
      ],
    });
  }

  return artifacts;
}
