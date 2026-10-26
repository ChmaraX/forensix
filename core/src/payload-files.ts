import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

/** A payload that the Case stores as a file named by its SHA-256. */
export interface PayloadFile {
  readonly sha256: string;
  readonly bytes: number;
  readonly data: Uint8Array;
}

export function payloadFile(data: Uint8Array): PayloadFile {
  return {
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.byteLength,
    data,
  };
}

async function holdsPayload(
  path: string,
  payload: PayloadFile,
): Promise<boolean> {
  try {
    const stats = await lstat(path);
    return (
      stats.isFile() &&
      stats.size === payload.bytes &&
      Buffer.from(payload.data).equals(await readFile(path))
    );
  } catch {
    return false;
  }
}

/**
 * Store each payload as `<directory>/<sha256>`. A file that already holds the
 * payload bytes is kept as it is: an earlier committed Analysis Run can cite
 * it. Any other file with that name is replaced through a new temporary file
 * and a rename, so a stopped write never leaves a truncated payload. After
 * the renames, the directory is synced so the new names survive a crash.
 */
export async function writePayloadFiles(
  directory: string,
  payloads: Iterable<PayloadFile>,
): Promise<void> {
  let directoryReady = false;
  let renamed = false;
  for (const payload of payloads) {
    if (!directoryReady) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      directoryReady = true;
    }
    const path = join(directory, payload.sha256);
    if (await holdsPayload(path, payload)) {
      continue;
    }
    const temporary = join(directory, `.${payload.sha256}.${randomUUID()}`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(payload.data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
      renamed = true;
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
  // Windows cannot open a directory for fsync, and NTFS journals the rename.
  if (renamed && process.platform !== "win32") {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
