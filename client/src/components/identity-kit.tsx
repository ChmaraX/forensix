/**
 * Shared by the identity pages (Cookies, Saved logins, Form data,
 * Bookmarks): the Case-wide profile lens as these pages apply it, and
 * empty states worded from the Completeness Statement (the shell's, via
 * `useArtifactCoverage` in case-context). Their cell links (host → Sites,
 * URL → History) are the shared `host-link.tsx`.
 */
import { useCallback, useMemo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { AppIcon } from "@/lib/app-icons";

import { artifactStoreOf } from "../artifacts.js";
import { hrefFor, updateView, useViewProfiles } from "../view-state.js";
import type { CoverageScope } from "./completeness.js";
import {
  emptyCoverageOf as coverageWordsOf,
  joinWords,
  type EmptyCoverage,
} from "./identity-coverage.js";
import { EmptyRows } from "./data-table.js";
import { profileLabel } from "./finding-fields.js";

/* ------------------------------- profile lens ----------------------------- */

/**
 * The Case-wide profile pick as these pages apply it (client-side, over the
 * loaded rows): `applies(profile)` keeps a row, `options` is what the
 * picker lists (the profiles the rows carry, plus any picked elsewhere that
 * carry none here, so a pick never disappears from its own picker), and
 * `showPicker` is false when there is nothing to choose between.
 */
export function useProfileLens(rowProfiles: readonly string[]): {
  readonly selected: readonly string[];
  readonly setSelected: (profiles: readonly string[]) => void;
  readonly options: readonly string[];
  readonly showPicker: boolean;
  readonly applies: (profile: string) => boolean;
  /** "Profile 2" / "Default profile and Profile 2", for empty-state words. */
  readonly words: string | null;
} {
  const [selected, setSelected] = useViewProfiles();
  const options = useMemo(
    () => [...new Set([...rowProfiles, ...selected])].sort(),
    [rowProfiles, selected],
  );
  const applies = useCallback(
    (profile: string) => selected.length === 0 || selected.includes(profile),
    [selected],
  );
  return {
    selected,
    setSelected,
    options,
    showPicker: options.length > 1 || selected.length > 0,
    applies,
    words: selected.length === 0 ? null : joinWords(selected.map(profileLabel)),
  };
}

/** Drops the page's filters in one history entry: its search, its own
 *  pick (folder, category) and the profile pick (the lens), as History's
 *  "Clear filters" does. */
export function clearSearchAndProfiles(): void {
  updateView({ q: null, filter: null, profiles: [] });
}

/* ------------------------------- empty states ----------------------------- */

/** How an artifact with no rows was covered, profiles in their one name. */
export function emptyCoverageOf(scope: CoverageScope | null): EmptyCoverage {
  return coverageWordsOf(scope, profileLabel);
}

/**
 * The empty state of an identity page with no rows at all, worded from its
 * coverage (onboard: what would be here, why there is nothing, where to
 * look next):
 *  - read and empty: "Login Data was read for Default profile and Profile
 *    2 and holds no stored logins, saved or recovered.";
 *  - no file anywhere: "No Login Data database" / "No Bookmarks file" - a
 *    missing database is not an empty one, and the words keep the two
 *    apart;
 *  - not analysed: says so.
 */
export function ArtifactEmpty({
  icon,
  coverage,
  artifact,
  title,
  what,
  sidecars = true,
  pivot,
}: {
  readonly icon: AppIcon;
  readonly coverage: EmptyCoverage;
  /** The Completeness artifact Chrome keeps these rows in ("Login
   *  Data"); its store word (database / file) follows from it. */
  readonly artifact: string;
  /** "No saved logins". */
  readonly title: string;
  /** "stored logins" (plural noun, lower case). */
  readonly what: string;
  /** The file has WAL / journal sidecars (so "saved or recovered" applies). */
  readonly sidecars?: boolean;
  /** The next place to look (`EmptyPivot`). */
  readonly pivot?: ReactNode;
}) {
  const either = sidecars ? ", saved or recovered" : "";
  const source = { name: artifact, kind: artifactStoreOf(artifact) };
  let heading = title;
  let message: string;
  switch (coverage.kind) {
    case "read":
      message = `${source.name} was read for ${coverage.read} and holds no ${what}${either}.`;
      break;
    case "no-file":
      heading = `No ${source.name} ${source.kind}`;
      message = `No profile in this Case has a ${source.name} ${source.kind}, where Chrome keeps ${what}. A missing ${source.kind} is not the same as an empty one.`;
      break;
    case "not-analysed":
      message = `${source.name} was not analysed for this Case, so there are no ${what} to list.`;
      break;
    default:
      message = `No ${what} in this Case${either}.`;
  }
  return (
    <EmptyRows
      icon={icon}
      title={heading}
      message={<span className="block text-pretty">{message}</span>}
      action={pivot}
    />
  );
}

/**
 * The next place to look from an empty page: one quiet tertiary link (a
 * real `<a>`, so it opens in a new tab too).
 */
export function EmptyPivot({
  page,
  children,
}: {
  readonly page: string;
  readonly children: ReactNode;
}) {
  return (
    <Button asChild variant="tertiary" size="compact">
      <a href={hrefFor(page)}>{children}</a>
    </Button>
  );
}
