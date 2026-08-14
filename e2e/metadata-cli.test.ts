import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const compiledCli = resolve("cli/dist/cli.js");
const temporaryRoots: string[] = [];

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface FieldValue<T> {
  readonly state: "value";
  readonly value: T;
  readonly synthetic?: boolean;
}

interface Unavailable {
  readonly state: "unavailable";
  readonly reason: string;
}

interface Absent {
  readonly state: "absent";
}

type Field<T> = FieldValue<T> | Unavailable | Absent;

interface MetadataFinding {
  readonly recordType: "finding";
  readonly findingKind: "browser_metadata" | "profile_metadata";
  readonly profile: string;
  readonly commitState: "committed" | "wal_resident" | "journal_resident";
  readonly provenance: {
    readonly sourceId: string;
    readonly manifestEntryId: string;
    readonly manifestEntryOrdinal: number;
    readonly manifestPath: string;
    readonly database: string;
    readonly table: string;
    readonly rowId: string;
    readonly supportingRows?: readonly {
      readonly manifestPath: string;
      readonly table: string;
      readonly rowId: string;
    }[];
  };
  readonly fields: Record<string, Field<unknown>>;
}

interface MetadataPage {
  readonly status: "ok";
  readonly command: "metadata";
  readonly items: readonly MetadataFinding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

function runCli(arguments_: readonly string[]): CliResult {
  const result = spawnSync(process.execPath, [compiledCli, ...arguments_], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value.trim()) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const LOCAL_STATE = {
  os_crypt: { encrypted_key: "QVBQTAABBBB" },
  variations_country: "us",
  variations_permanent_consistency_country: ["142.0.7444.0", "us"],
  profile: {
    last_used: "Default",
    profiles_order: ["Default", "Profile 1"],
    info_cache: {
      Default: {
        avatar_icon: "chrome://theme/IDR_PROFILE_AVATAR_26",
        gaia_name: "Ada Lovelace",
        gaia_given_name: "Ada",
        gaia_id: "1122334455",
        gaia_picture_file_name: "Google Profile Picture.png",
        user_name: "ada@example.com",
        is_using_default_avatar: false,
        is_using_default_name: false,
      },
      "Profile 1": {
        avatar_icon: "chrome://theme/IDR_PROFILE_AVATAR_5",
        user_name: "",
        is_using_default_avatar: true,
      },
    },
  },
};

const DEFAULT_PREFERENCES = {
  profile: {
    name: "Ada",
    created_by_version: "141.0.7390.55",
    exit_type: "Normal",
  },
  account_info: [
    {
      email: "ada@example.com",
      gaia: "1122334455",
      full_name: "Ada Lovelace",
      given_name: "Ada",
      locale: "en-US",
      hd: "example.com",
    },
  ],
  browser: {
    window_placement: {
      work_area_left: 0,
      work_area_top: 0,
      work_area_right: 1920,
      work_area_bottom: 1080,
    },
  },
};

// Profile 1 exercises the uncertainty contract: account_info is the wrong shape
// (unavailable, not absent), a window bound is non-numeric (unavailable), and
// created_by_version is simply not present (absent).
const PROFILE_ONE_PREFERENCES = {
  profile: { name: "Work" },
  account_info: "not-an-array",
  browser: {
    window_placement: {
      work_area_left: 0,
      work_area_top: 0,
      work_area_right: "wide",
      work_area_bottom: 1200,
    },
  },
};

async function createSource(root: string): Promise<string> {
  const source = join(root, "source");
  await mkdir(join(source, "Default"), { recursive: true });
  await mkdir(join(source, "Profile 1"), { recursive: true });
  await writeJson(join(source, "Local State"), LOCAL_STATE);
  await writeJson(join(source, "Default", "Preferences"), DEFAULT_PREFERENCES);
  await writeJson(
    join(source, "Profile 1", "Preferences"),
    PROFILE_ONE_PREFERENCES,
  );
  return source;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI Metadata Finding pipeline", () => {
  it("parses browser and Profile metadata with correct scoping", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-metadata-e2e-"));
    temporaryRoots.push(root);
    const source = await createSource(root);
    const localStateBytes = await readFile(join(source, "Local State"));
    const caseDirectory = join(root, "CASE-METADATA");

    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    // AC1/AC4: one browser-level artifact plus one artifact per Profile.
    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      command: "analyse",
      preferences: {
        status: "complete",
        analysedArtifactCount: 3,
        browserMetadataCount: 1,
        profileMetadataCount: 2,
        findingCount: 3,
      },
    });

    // AC5/AC6: sorted by Profile ascending, "." (browser) sorts first.
    const all = parseJson<MetadataPage>(
      runCli(["metadata", "--case", caseDirectory, "--json"]).stdout,
    );
    expect(all.items.map((row) => row.profile)).toEqual([
      ".",
      "Default",
      "Profile 1",
    ]);

    // AC2: browser-level values verified against current Local State schema.
    const browser = all.items[0];
    expect(browser).toMatchObject({
      findingKind: "browser_metadata",
      profile: ".",
      commitState: "committed",
      provenance: {
        manifestPath: "Local State",
        database: "Local State",
        table: "local_state",
        rowId: "local_state",
      },
      fields: {
        scope: { state: "value", value: "browser" },
        chromeVersion: { state: "value", value: "142.0.7444.0" },
        variationsCountry: { state: "value", value: "us" },
        lastUsedProfile: { state: "value", value: "Default" },
        profileCount: { state: "value", value: "2" },
        osCryptKeyPresent: { state: "value", value: true },
        osCryptAppBoundKeyPresent: { state: "absent" },
      },
    });

    // AC2/AC4: Profile-level values, with avatar and demographics drawn from the
    // browser file's info_cache slice and attributed via a supporting row.
    const defaultProfile = all.items[1];
    expect(defaultProfile).toMatchObject({
      findingKind: "profile_metadata",
      profile: "Default",
      provenance: {
        manifestPath: "Default/Preferences",
        database: "Default/Preferences",
        table: "preferences",
        rowId: "Default",
        supportingRows: [
          {
            manifestPath: "Local State",
            table: "local_state",
            rowId: "profile.info_cache/Default",
          },
        ],
      },
      fields: {
        profileName: { state: "value", value: "Ada" },
        createdByVersion: { state: "value", value: "141.0.7390.55" },
        accountCount: { state: "value", value: "1" },
        accountEmail: { state: "value", value: "ada@example.com" },
        accountLocale: { state: "value", value: "en-US" },
        // AC1: screen work area derived from the window placement, synthetic.
        screenWorkArea: {
          state: "value",
          value: "1920x1080",
          synthetic: true,
        },
        avatarIcon: {
          state: "value",
          value: "chrome://theme/IDR_PROFILE_AVATAR_26",
        },
        gaiaName: { state: "value", value: "Ada Lovelace" },
      },
    });

    // AC3: malformed and absent inputs are distinct, typed, and never blank.
    const workProfile = all.items[2];
    expect(workProfile?.fields.profileName).toEqual({
      state: "value",
      value: "Work",
    });
    expect(workProfile?.fields.createdByVersion).toEqual({ state: "absent" });
    expect(workProfile?.fields.accountCount).toEqual({
      state: "unavailable",
      reason: "unsupported_value",
    });
    expect(workProfile?.fields.accountEmail).toEqual({ state: "absent" });
    expect(workProfile?.fields.workAreaRight).toEqual({
      state: "unavailable",
      reason: "unsupported_value",
    });
    expect(workProfile?.fields.screenWorkArea).toEqual({
      state: "unavailable",
      reason: "unsupported_value",
    });
    // Profile 1 has an info_cache slice, so its avatar is present but its
    // gaia_name simply is not recorded there (absent, not unavailable).
    expect(workProfile?.fields.avatarIcon).toEqual({
      state: "value",
      value: "chrome://theme/IDR_PROFILE_AVATAR_5",
    });
    expect(workProfile?.fields.gaiaName).toEqual({ state: "absent" });

    // AC6: type filter narrows to a single scope.
    const browserOnly = parseJson<MetadataPage>(
      runCli([
        "metadata",
        "--case",
        caseDirectory,
        "--type",
        "browser_metadata",
        "--json",
      ]).stdout,
    );
    expect(browserOnly.items).toHaveLength(1);
    expect(browserOnly.items[0]?.profile).toBe(".");

    // AC6: Profile filter, search, keyset pagination, and cursor rejection.
    const paged = parseJson<MetadataPage>(
      runCli([
        "metadata",
        "--case",
        caseDirectory,
        "--type",
        "profile_metadata",
        "--sort",
        "profile",
        "--direction",
        "asc",
        "--limit",
        "1",
        "--json",
      ]).stdout,
    );
    expect(paged.items).toHaveLength(1);
    expect(paged.items[0]?.profile).toBe("Default");
    expect(paged.nextCursor).not.toBeNull();

    const next = parseJson<MetadataPage>(
      runCli([
        "metadata",
        "--case",
        caseDirectory,
        "--type",
        "profile_metadata",
        "--sort",
        "profile",
        "--direction",
        "asc",
        "--limit",
        "1",
        "--after",
        paged.nextCursor as string,
        "--json",
      ]).stdout,
    );
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.profile).toBe("Profile 1");
    expect(next.nextCursor).toBeNull();

    const searched = parseJson<MetadataPage>(
      runCli([
        "metadata",
        "--case",
        caseDirectory,
        "--search",
        "ada@example.com",
        "--json",
      ]).stdout,
    );
    expect(searched.items).toHaveLength(1);
    expect(searched.items[0]?.profile).toBe("Default");

    // AC6: broken input rejected.
    const badLimit = runCli([
      "metadata",
      "--case",
      caseDirectory,
      "--limit",
      "0",
      "--json",
    ]);
    expect(badLimit.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(badLimit.stderr)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });

    // AC6: a stale cursor after re-analysis is rejected.
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );
    const stale = runCli([
      "metadata",
      "--case",
      caseDirectory,
      "--type",
      "profile_metadata",
      "--sort",
      "profile",
      "--direction",
      "asc",
      "--limit",
      "1",
      "--after",
      paged.nextCursor as string,
      "--json",
    ]);
    expect(stale.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(stale.stderr)).toMatchObject({
      code: "INVALID_CURSOR",
    });

    // AC1: analysis never mutates the Source bytes.
    expect(await readFile(join(source, "Local State"))).toEqual(
      localStateBytes,
    );
  });

  it("reports malformed and missing JSON as typed unavailable metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-metadata-bad-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(join(source, "Default"), { recursive: true });
    await mkdir(join(source, "Profile 1"), { recursive: true });
    // A byte-intact but unparseable browser file, and one good Profile file.
    await writeFile(join(source, "Local State"), "{ not valid json ,,");
    await writeJson(
      join(source, "Default", "Preferences"),
      DEFAULT_PREFERENCES,
    );
    await writeFile(join(source, "Profile 1", "Preferences"), "{ broken");
    const caseDirectory = join(root, "CASE-METADATA-BAD");

    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    // Metadata does not drive the Analysis Run exit state, but its own summary
    // reports the malformed inputs as a partial metadata result while the
    // defensible Default Profile metadata stays queryable.
    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      preferences: {
        status: "partial",
        analysedArtifactCount: 1,
        unavailableArtifactCount: 2,
      },
    });

    // AC3/AC4: the browser file is unreadable, so a Profile that depends on its
    // info_cache reports those fields as unavailable, never silently absent.
    const results = parseJson<MetadataPage>(
      runCli([
        "metadata",
        "--case",
        caseDirectory,
        "--type",
        "profile_metadata",
        "--json",
      ]).stdout,
    );
    expect(results.items).toHaveLength(1);
    const defaultProfile = results.items[0];
    expect(defaultProfile?.profile).toBe("Default");
    expect(defaultProfile?.fields.profileName).toEqual({
      state: "value",
      value: "Ada",
    });
    expect(defaultProfile?.fields.avatarIcon).toEqual({
      state: "unavailable",
      reason: "related_row_missing",
    });
    expect(defaultProfile?.provenance.supportingRows).toBeUndefined();
  });
});
