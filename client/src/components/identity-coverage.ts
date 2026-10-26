/**
 * The pure words behind the identity pages' empty states and profile
 * lens (identity-kit.tsx): how an artifact with no rows was covered, and
 * a list of names joined for a sentence. No React, unit-tested in
 * identity-coverage.test.ts.
 */
import type { CoverageScope } from "./completeness.js";
import { profileLabel } from "./finding-fields.js";

/** "A", "A and B", "A, B and C". */
export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) {
    return words[0] ?? "";
  }
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

/** How an artifact with no rows at all was covered, in the words its empty
 *  state needs. */
export type EmptyCoverage =
  /** Not known yet (or the statement could not be read). */
  | { readonly kind: "unknown" }
  /** No statement for the artifact: it was not analysed. */
  | { readonly kind: "not-analysed" }
  /** Every profile was looked at and none has the file. */
  | { readonly kind: "no-file" }
  /** Some (or all) files were read; `read` names their profiles (what was
   *  not read, the shell's banner names above the page). */
  | { readonly kind: "read"; readonly read: string };

/** How an artifact with no rows was covered, profiles in their one name
 *  (`profileLabel`). */
export function emptyCoverageOf(scope: CoverageScope | null): EmptyCoverage {
  if (scope === null) {
    return { kind: "unknown" };
  }
  if (scope.statements.length === 0) {
    return { kind: "not-analysed" };
  }
  const read = scope.statements.flatMap((statement) =>
    statement.artifacts
      .filter((entry) => entry.outcome === "produced")
      .map((entry) => profileLabel(entry.profile)),
  );
  if (read.length === 0) {
    return scope.unavailable === 0 ? { kind: "no-file" } : { kind: "unknown" };
  }
  return { kind: "read", read: joinWords([...new Set(read)]) };
}
