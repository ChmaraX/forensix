import { describe, expect, it } from "vitest";

import type { FieldState, Finding } from "../types.js";
import { toRow } from "./downloads-model.js";

const value = (v: unknown): FieldState => ({ state: "value", value: v });

function download(fields: Record<string, FieldState>): Finding {
  return {
    recordType: "finding",
    findingKind: "download",
    profile: "Default",
    commitState: "committed",
    provenance: {
      manifestPath: "src-01/manifest.jsonl",
      table: "downloads",
      rowId: "7",
    },
    fields: {
      targetPath: value("C:\\Users\\m\\Downloads\\setup.exe"),
      originalUrl: value("https://www.example.com/setup.exe"),
      ...fields,
    },
  };
}

describe("toRow: received and expected bytes", () => {
  it("keeps what was received apart from what was expected", () => {
    const row = toRow(
      download({
        receivedBytes: value("9856000"),
        totalBytes: value("29568000"),
      }),
    );
    expect(row.received).toBe(9_856_000);
    expect(row.expected).toBe(29_568_000);
  });

  it("reads an unknown total (Chrome's 0 or -1) as no expected size", () => {
    expect(
      toRow(download({ receivedBytes: value("10"), totalBytes: value("0") }))
        .expected,
    ).toBeNull();
    expect(
      toRow(download({ receivedBytes: value("10"), totalBytes: value("-1") }))
        .expected,
    ).toBeNull();
  });

  it("never stands the expected size in for an unrecorded received size", () => {
    const row = toRow(
      download({
        receivedBytes: { state: "absent" },
        totalBytes: value("4096"),
      }),
    );
    expect(row.received).toBeNull();
    expect(row.expected).toBe(4096);
  });

  it("keeps a recorded zero received as zero, not as absent", () => {
    const row = toRow(
      download({ receivedBytes: value("0"), totalBytes: value("4096") }),
    );
    expect(row.received).toBe(0);
  });

  it("reads the file name, source host and start from the row", () => {
    const row = toRow(
      download({ startTime: value({ utc: "2024-03-13T10:50:39Z", raw: "1" }) }),
    );
    expect(row.name).toBe("setup.exe");
    expect(row.host).toBe("www.example.com");
    expect(row.startUtc).toBe("2024-03-13T10:50:39Z");
  });
});
