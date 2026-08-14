import { describe, expect, it } from "vitest";

import {
  absentField,
  unavailableField,
  valueField,
  type FieldState,
} from "../src/forensic-model.js";
import {
  chromeVersionField,
  integerField,
  lookup,
  screenWorkAreaField,
  stringField,
  type Lookup,
} from "../src/preferences.js";

describe("lookup", () => {
  const document = {
    profile: { name: "Ada", nested: { deep: 1 } },
    cleared: null,
    scalar: "leaf",
  };

  const cases: ReadonlyArray<{
    readonly label: string;
    readonly keys: readonly string[];
    readonly expected: Lookup;
  }> = [
    {
      label: "resolves a nested value",
      keys: ["profile", "name"],
      expected: { kind: "value", value: "Ada" },
    },
    {
      label: "treats a missing key as absent",
      keys: ["profile", "missing"],
      expected: { kind: "absent" },
    },
    {
      label: "treats an explicit null as absent",
      keys: ["cleared"],
      expected: { kind: "absent" },
    },
    {
      label: "treats a scalar mid-path as malformed",
      keys: ["scalar", "deeper"],
      expected: { kind: "malformed" },
    },
    {
      label: "treats descending into null as absent",
      keys: ["cleared", "child"],
      expected: { kind: "absent" },
    },
  ];

  for (const testCase of cases) {
    it(testCase.label, () => {
      expect(lookup(document, testCase.keys)).toEqual(testCase.expected);
    });
  }

  it("treats an array as a non-navigable, malformed container", () => {
    expect(lookup({ list: [1, 2] }, ["list", "0"])).toEqual({
      kind: "malformed",
    });
  });
});

describe("stringField", () => {
  it("keeps a string value", () => {
    expect(stringField({ kind: "value", value: "x" })).toEqual(valueField("x"));
  });

  it("maps a missing key to absent", () => {
    expect(stringField({ kind: "absent" })).toEqual(absentField());
  });

  it("maps a wrong-shaped document to unavailable", () => {
    expect(stringField({ kind: "malformed" })).toEqual(
      unavailableField("unsupported_value"),
    );
  });

  it("maps a wrong-typed value to unavailable", () => {
    expect(stringField({ kind: "value", value: 42 })).toEqual(
      unavailableField("unsupported_value"),
    );
  });
});

describe("integerField", () => {
  it("stringifies an integer", () => {
    expect(integerField({ kind: "value", value: 1920 })).toEqual(
      valueField("1920"),
    );
  });

  it("rejects a non-integer number", () => {
    expect(integerField({ kind: "value", value: 1.5 })).toEqual(
      unavailableField("unsupported_value"),
    );
  });

  it("rejects a numeric string", () => {
    expect(integerField({ kind: "value", value: "1920" })).toEqual(
      unavailableField("unsupported_value"),
    );
  });
});

describe("chromeVersionField", () => {
  it("reads the version from the variations consistency tuple", () => {
    expect(
      chromeVersionField({
        variations_permanent_consistency_country: ["142.0.7444.0", "us"],
      }),
    ).toEqual(valueField("142.0.7444.0"));
  });

  it("is absent when the key is not recorded", () => {
    expect(chromeVersionField({})).toEqual(absentField());
  });

  it("is unavailable when the tuple is not an array", () => {
    expect(
      chromeVersionField({ variations_permanent_consistency_country: "142" }),
    ).toEqual(unavailableField("unsupported_value"));
  });

  it("is unavailable when the first element is not a string", () => {
    expect(
      chromeVersionField({
        variations_permanent_consistency_country: [142, "us"],
      }),
    ).toEqual(unavailableField("unsupported_value"));
  });
});

describe("screenWorkAreaField", () => {
  const bound = (value: number): FieldState<string> =>
    valueField(value.toString());

  it("derives a synthetic WxH from the four bounds", () => {
    expect(
      screenWorkAreaField(bound(0), bound(0), bound(1920), bound(1080)),
    ).toEqual(valueField("1920x1080", { synthetic: true }));
  });

  it("subtracts a non-zero origin", () => {
    expect(
      screenWorkAreaField(bound(100), bound(50), bound(1380), bound(818)),
    ).toEqual(valueField("1280x768", { synthetic: true }));
  });

  it("is absent when any bound is absent", () => {
    expect(
      screenWorkAreaField(bound(0), absentField(), bound(1920), bound(1080)),
    ).toEqual(absentField());
  });

  it("is unavailable when any bound is unavailable", () => {
    expect(
      screenWorkAreaField(
        bound(0),
        bound(0),
        unavailableField("unsupported_value"),
        bound(1080),
      ),
    ).toEqual(unavailableField("unsupported_value"));
  });

  it("rejects a degenerate (non-positive) area", () => {
    expect(
      screenWorkAreaField(bound(1920), bound(0), bound(1920), bound(1080)),
    ).toEqual(unavailableField("unsupported_value"));
  });

  it("prefers unavailable over absent when both are present", () => {
    expect(
      screenWorkAreaField(
        absentField(),
        bound(0),
        unavailableField("unsupported_value"),
        bound(1080),
      ),
    ).toEqual(unavailableField("unsupported_value"));
  });
});
