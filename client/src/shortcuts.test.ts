import { describe, expect, it } from "vitest";

import {
  parseSingleKeySetting,
  rowKeyDelta,
  sidebarKeyFires,
  type FocusPlace,
  type KeyInput,
} from "./shortcuts.js";

const key = (value: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({
  key: value,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...modifiers,
});

const EVERY_PLACE: readonly FocusPlace[] = [
  "body",
  "row",
  "list",
  "page",
  "control",
  "field",
  "dialog",
  "outside",
];

describe("rowKeyDelta", () => {
  it("moves with J / K from a row, a list or the page itself", () => {
    for (const place of ["body", "row", "list", "page"] as const) {
      expect(rowKeyDelta(key("j"), place, true)).toBe(1);
      expect(rowKeyDelta(key("k"), place, true)).toBe(-1);
    }
  });

  it("leaves J / K alone on a control, a field, a dialog, the sidebar or the topbar", () => {
    for (const place of ["control", "field", "dialog", "outside"] as const) {
      expect(rowKeyDelta(key("j"), place, true)).toBeNull();
      expect(rowKeyDelta(key("k"), place, true)).toBeNull();
    }
  });

  it("ignores every modifier combo, Shift included", () => {
    for (const modifier of [
      { shiftKey: true },
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
    ]) {
      expect(rowKeyDelta(key("j", modifier), "row", true)).toBeNull();
      expect(rowKeyDelta(key("ArrowDown", modifier), "row", true)).toBeNull();
    }
    // Shift+J arrives as "J".
    expect(rowKeyDelta(key("J", { shiftKey: true }), "body", true)).toBeNull();
  });

  it("does nothing with J / K when single-key shortcuts are off", () => {
    for (const place of EVERY_PLACE) {
      expect(rowKeyDelta(key("j"), place, false)).toBeNull();
      expect(rowKeyDelta(key("k"), place, false)).toBeNull();
    }
  });

  it("answers the arrows only on a row, whatever the setting", () => {
    expect(rowKeyDelta(key("ArrowDown"), "row", false)).toBe(1);
    expect(rowKeyDelta(key("ArrowUp"), "row", true)).toBe(-1);
    for (const place of EVERY_PLACE.filter((place) => place !== "row")) {
      expect(rowKeyDelta(key("ArrowDown"), place, true)).toBeNull();
    }
  });

  it("ignores other keys", () => {
    expect(rowKeyDelta(key("l"), "row", true)).toBeNull();
    expect(rowKeyDelta(key("Enter"), "row", true)).toBeNull();
  });
});

describe("sidebarKeyFires", () => {
  it("toggles from the page itself only", () => {
    expect(sidebarKeyFires(key("["), "body", true)).toBe(true);
    expect(sidebarKeyFires(key("["), "page", true)).toBe(true);
    for (const place of [
      "row",
      "list",
      "control",
      "field",
      "dialog",
      "outside",
    ] as const) {
      expect(sidebarKeyFires(key("["), place, true)).toBe(false);
    }
  });

  it("never with a modifier (the browser's ⌘[ / Ctrl+[ stay theirs)", () => {
    expect(sidebarKeyFires(key("[", { metaKey: true }), "body", true)).toBe(
      false,
    );
    expect(sidebarKeyFires(key("[", { ctrlKey: true }), "body", true)).toBe(
      false,
    );
    expect(sidebarKeyFires(key("[", { altKey: true }), "body", true)).toBe(
      false,
    );
  });

  it("never when single-key shortcuts are off, and only for [", () => {
    expect(sidebarKeyFires(key("["), "body", false)).toBe(false);
    expect(sidebarKeyFires(key("]"), "body", true)).toBe(false);
  });
});

describe("parseSingleKeySetting", () => {
  it("is on by default and off only when stored off", () => {
    expect(parseSingleKeySetting(null)).toBe(true);
    expect(parseSingleKeySetting("on")).toBe(true);
    expect(parseSingleKeySetting("garbage")).toBe(true);
    expect(parseSingleKeySetting("off")).toBe(false);
  });
});
