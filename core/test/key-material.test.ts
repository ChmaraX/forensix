import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ForensixError } from "../src/errors.js";
import { loadAuthorizedKeyMaterial } from "../src/key-material.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function keyMaterialFile(contents: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forensix-key-material-"));
  temporaryRoots.push(root);
  const path = join(root, "key-material.json");
  await writeFile(path, JSON.stringify(contents));
  return path;
}

const secretBase64 = Buffer.from("keyring-secret").toString("base64");

describe("loadAuthorizedKeyMaterial with malformed input", () => {
  it("keeps the valid supplied entries and reports each malformed one", async () => {
    const path = await keyMaterialFile({
      schema: "forensix/supplied-key-material/1",
      entries: [
        {
          recordId: "op-gnome",
          route: "gnome-keyring",
          keyKind: "passphrase",
          rowPrefix: "v11",
          secretBase64,
        },
        { recordId: "op-bad-route", route: "gnome_keyring", secretBase64 },
        { record_id: "op-bad-secret", route: "kwallet", secret_base64: 42 },
        {
          recordId: "op-bad-prefix",
          route: "linux-basic",
          rowPrefix: "v12",
          secretBase64,
        },
        {
          recordId: "op-bad-provider",
          route: "macos-keychain",
          provider: { platform: "macos" },
          secretBase64,
        },
        "not an entry",
      ],
    });

    const resolved = loadAuthorizedKeyMaterial({ keyMaterialPath: path });

    expect(resolved.material.map((item) => item.provenance)).toEqual([
      {
        origin: "supplied",
        recordId: "op-gnome",
        route: "gnome-keyring",
        rowPrefix: "v11",
        profileScope: null,
        evidenceSha256: [],
        providerPlatform: "unknown",
        providerName: "supplied",
        providerItem: "supplied",
        providerScope: "supplied",
      },
    ]);
    expect(resolved.issues).toEqual([
      { recordId: "op-bad-route", reason: "invalid_route" },
      { recordId: "op-bad-secret", reason: "invalid_secret" },
      { recordId: "op-bad-prefix", reason: "invalid_row_prefix" },
      { recordId: "op-bad-provider", reason: "invalid_provider" },
      { recordId: "supplied-5", reason: "invalid_entry" },
    ]);
  });

  it("reports a captured record that does not match the record schema", async () => {
    const path = await keyMaterialFile({
      schema: "forensix/key-material-bundle/1",
      records: [
        {
          schema_version: "forensix/key-material-record/1",
          record_id: "udd-0-default",
          capture_state: "captured",
          key_kind: "oscrypt_row_key",
          usable_row_key: true,
          // The provider and policy objects are missing.
          context: [],
          evidence: [],
          sealed_material: null,
        },
        null,
      ],
    });

    expect(loadAuthorizedKeyMaterial({ keyMaterialPath: path })).toEqual({
      material: [],
      issues: [
        { recordId: "udd-0-default", reason: "invalid_record" },
        { recordId: "record-1", reason: "invalid_record" },
      ],
    });
  });

  it("refuses a file without its entry list as an invalid argument", async () => {
    for (const contents of [
      { schema: "forensix/supplied-key-material/1", entries: "op-gnome" },
      { schema: "forensix/key-material-bundle/1" },
      [{ schema: "forensix/supplied-key-material/1" }],
    ]) {
      const path = await keyMaterialFile(contents);
      let thrown: unknown;
      try {
        loadAuthorizedKeyMaterial({ keyMaterialPath: path });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ForensixError);
      expect((thrown as ForensixError).code).toBe("INVALID_ARGUMENT");
    }
  });
});
