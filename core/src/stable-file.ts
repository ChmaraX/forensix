import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { BigIntStats } from "node:fs";

const READ_BUFFER_SIZE = 1024 * 1024;

export type StableFileReadResult =
  | {
      readonly status: "stable";
      readonly size: number;
      readonly sha256: string;
    }
  | {
      readonly status: "changed" | "too_large";
    }
  | {
      readonly status: "open_failed" | "read_failed";
      readonly error: unknown;
    };

export function sameNodeMetadata(
  left: BigIntStats,
  right: BigIntStats,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

export async function readStableRegularFile(
  path: string,
  initialStats: BigIntStats,
  writeChunk?: (chunk: Buffer) => Promise<void>,
): Promise<StableFileReadResult> {
  if (initialStats.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { status: "too_large" };
  }

  const noFollowFlag = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | noFollowFlag);
  } catch (error) {
    return { status: "open_failed", error };
  }

  try {
    const openedStats = await handle.stat({ bigint: true });
    if (!openedStats.isFile() || !sameNodeMetadata(initialStats, openedStats)) {
      return { status: "changed" };
    }

    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(READ_BUFFER_SIZE);
    let size = 0;
    while (true) {
      let bytesRead: number;
      try {
        ({ bytesRead } = await handle.read(buffer, 0, buffer.length, null));
      } catch (error) {
        return { status: "read_failed", error };
      }
      if (bytesRead === 0) {
        break;
      }

      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      size += bytesRead;
      await writeChunk?.(chunk);
    }

    const finalHandleStats = await handle.stat({ bigint: true });
    let finalPathStats: BigIntStats;
    try {
      finalPathStats = await lstat(path, { bigint: true });
    } catch {
      return { status: "changed" };
    }
    if (
      !sameNodeMetadata(initialStats, finalHandleStats) ||
      !sameNodeMetadata(initialStats, finalPathStats) ||
      size !== Number(initialStats.size)
    ) {
      return { status: "changed" };
    }

    return { status: "stable", size, sha256: digest.digest("hex") };
  } finally {
    await handle.close().catch(() => undefined);
  }
}
