import { describe, expect, it } from "vitest";

import {
  bandIndexAt,
  chartKeyEffect,
  FULL_SPAN,
  pickDay,
  releaseSpan,
  spanOf,
  startIndex,
} from "./chart-keys.js";

const options = { count: 5, start: 2, selectable: true, ranged: false };

describe("pointer picking", () => {
  it("maps a position to its band, clamped to the plot", () => {
    // Plot from x=40, 500px wide, 5 bands of 100px.
    expect(bandIndexAt(40, 40, 500, 5)).toBe(0);
    expect(bandIndexAt(139, 40, 500, 5)).toBe(0);
    expect(bandIndexAt(140, 40, 500, 5)).toBe(1);
    expect(bandIndexAt(539, 40, 500, 5)).toBe(4);
    // A drag past either edge keeps the edge band.
    expect(bandIndexAt(-30, 40, 500, 5)).toBe(0);
    expect(bandIndexAt(900, 40, 500, 5)).toBe(4);
    expect(bandIndexAt(100, 40, 0, 5)).toBeNull();
    expect(bandIndexAt(100, 40, 500, 0)).toBeNull();
  });

  it("a release on the pressed day picks it, again clears; across days spans", () => {
    expect(releaseSpan("2024-03-04", "2024-03-04", FULL_SPAN)).toEqual({
      from: "2024-03-04",
      to: "2024-03-04",
    });
    expect(
      releaseSpan("2024-03-04", "2024-03-04", {
        from: "2024-03-04",
        to: "2024-03-04",
      }),
    ).toEqual(FULL_SPAN);
    // Right to left reads the same as left to right.
    expect(releaseSpan("2024-03-09", "2024-03-04", FULL_SPAN)).toEqual({
      from: "2024-03-04",
      to: "2024-03-09",
    });
    expect(
      pickDay("2024-03-04", { from: "2024-03-04", to: "2024-03-06" }),
    ).toEqual({ from: "2024-03-04", to: "2024-03-04" });
    expect(spanOf("b", "a")).toEqual({ from: "a", to: "b" });
  });
});

describe("keyboard", () => {
  const dates = ["2024-03-01", "2024-03-02", "2024-03-03", "2024-03-04"];

  it("starts on the range's last day, else the peak, else the last day", () => {
    expect(startIndex(dates, [1, 4, 2, 0], FULL_SPAN)).toBe(1);
    expect(
      startIndex(dates, [1, 4, 2, 0], { from: "2024-03-02", to: "2024-03-03" }),
    ).toBe(2);
    expect(
      startIndex(dates, [1, 4, 2, 0], { from: "2024-03-03", to: "" }),
    ).toBe(3);
    expect(startIndex(dates, [0, 0, 0, 0], undefined)).toBe(3);
  });

  it("arrows move the cursor a day, clamped; the first key only shows it", () => {
    const state = { cursor: null, anchor: null };
    expect(chartKeyEffect("ArrowRight", false, state, options)).toEqual({
      kind: "move",
      cursor: 2,
      anchor: null,
    });
    expect(
      chartKeyEffect("ArrowRight", false, { cursor: 2, anchor: null }, options),
    ).toEqual({ kind: "move", cursor: 3, anchor: null });
    expect(
      chartKeyEffect("ArrowLeft", false, { cursor: 0, anchor: null }, options),
    ).toEqual({ kind: "move", cursor: 0, anchor: null });
    expect(
      chartKeyEffect("End", false, { cursor: 1, anchor: null }, options),
    ).toEqual({ kind: "move", cursor: 4, anchor: null });
    expect(
      chartKeyEffect("Home", false, { cursor: 3, anchor: null }, options),
    ).toEqual({ kind: "move", cursor: 0, anchor: null });
  });

  it("Enter and Space pick the cursor's day", () => {
    expect(
      chartKeyEffect("Enter", false, { cursor: 3, anchor: null }, options),
    ).toEqual({ kind: "pick", index: 3 });
    expect(
      chartKeyEffect(" ", false, { cursor: 1, anchor: null }, options),
    ).toEqual({ kind: "pick", index: 1 });
  });

  it("Shift+arrows stretch the range from where the cursor stood", () => {
    const first = chartKeyEffect(
      "ArrowRight",
      true,
      { cursor: 1, anchor: null },
      options,
    );
    expect(first).toEqual({ kind: "move", cursor: 2, anchor: 1 });
    expect(
      chartKeyEffect("ArrowRight", true, { cursor: 2, anchor: 1 }, options),
    ).toEqual({ kind: "move", cursor: 3, anchor: 1 });
    // Back past the anchor keeps it; the hook sorts the span.
    expect(
      chartKeyEffect("Home", true, { cursor: 3, anchor: 2 }, options),
    ).toEqual({ kind: "move", cursor: 0, anchor: 2 });
    // Enter during a stretch commits the span as it stands.
    expect(
      chartKeyEffect("Enter", true, { cursor: 4, anchor: 2 }, options),
    ).toEqual({ kind: "commit", from: 2, to: 4 });
    expect(
      chartKeyEffect("Enter", false, { cursor: 0, anchor: 2 }, options),
    ).toEqual({ kind: "commit", from: 0, to: 2 });
    // A plain arrow ends the stretch.
    expect(
      chartKeyEffect("ArrowLeft", false, { cursor: 4, anchor: 2 }, options),
    ).toEqual({ kind: "move", cursor: 3, anchor: null });
  });

  it("Escape clears a range (or a stretch), else is not the chart's", () => {
    expect(
      chartKeyEffect("Escape", false, { cursor: 3, anchor: 1 }, options),
    ).toEqual({ kind: "clear" });
    expect(
      chartKeyEffect(
        "Escape",
        false,
        { cursor: 3, anchor: null },
        { ...options, ranged: true },
      ),
    ).toEqual({ kind: "clear" });
    expect(
      chartKeyEffect("Escape", false, { cursor: 3, anchor: null }, options),
    ).toBeNull();
  });

  it("a read-only chart only browses", () => {
    const readOnly = { ...options, selectable: false, ranged: true };
    expect(
      chartKeyEffect("ArrowRight", true, { cursor: 1, anchor: null }, readOnly),
    ).toEqual({ kind: "move", cursor: 2, anchor: null });
    expect(
      chartKeyEffect("Enter", false, { cursor: 1, anchor: null }, readOnly),
    ).toBeNull();
    expect(
      chartKeyEffect("Escape", false, { cursor: 1, anchor: null }, readOnly),
    ).toBeNull();
  });

  it("ignores other keys and empty charts", () => {
    expect(
      chartKeyEffect("j", false, { cursor: 1, anchor: null }, options),
    ).toBeNull();
    expect(
      chartKeyEffect(
        "ArrowRight",
        false,
        { cursor: null, anchor: null },
        {
          ...options,
          count: 0,
        },
      ),
    ).toBeNull();
  });
});
