import { describe, expect, it } from "vitest";

import { rowOffsets, windowItems, windowRange } from "./use-windowed-rows.js";

describe("windowed rows", () => {
  // 10 rows of 40px, row 2 measured at 100px.
  const offsets = rowOffsets(10, new Map([[2, 100]]), 40);

  it("lays rows out from measured heights and the estimate", () => {
    expect([...offsets]).toEqual([
      0, 40, 80, 180, 220, 260, 300, 340, 380, 420, 460,
    ]);
  });

  it("takes the rows overlapping the view", () => {
    expect(windowRange(offsets, 0, 100)).toEqual({ start: 0, end: 3 });
    expect(windowRange(offsets, 150, 230)).toEqual({ start: 2, end: 5 });
    // Past the end keeps the last row; before the start, the first rows.
    expect(windowRange(offsets, 900, 1000)).toEqual({ start: 9, end: 10 });
    expect(windowRange(offsets, -500, 10)).toEqual({ start: 0, end: 1 });
    expect(windowRange(rowOffsets(0, new Map(), 40), 0, 100)).toEqual({
      start: 0,
      end: 0,
    });
  });

  it("stands spacers of the right height for the rows left out", () => {
    expect(windowItems(3, 5, [], offsets)).toEqual([
      { kind: "gap", key: "gap-0", height: 180 },
      { kind: "row", index: 3 },
      { kind: "row", index: 4 },
      { kind: "gap", key: "gap-5", height: 200 },
    ]);
  });

  it("keeps a focused row and its neighbours mounted outside the window", () => {
    expect(windowItems(7, 9, [0, 1, 2], offsets)).toEqual([
      { kind: "row", index: 0 },
      { kind: "row", index: 1 },
      { kind: "row", index: 2 },
      { kind: "gap", key: "gap-3", height: 160 },
      { kind: "row", index: 7 },
      { kind: "row", index: 8 },
      { kind: "gap", key: "gap-9", height: 40 },
    ]);
    // Out-of-range pins (the row before the first) are ignored.
    expect(windowItems(0, 1, [-1, 0, 1], offsets).slice(0, 2)).toEqual([
      { kind: "row", index: 0 },
      { kind: "row", index: 1 },
    ]);
  });
});
