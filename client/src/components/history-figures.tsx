/**
 * Figure-strip values that are not (yet) a number: a read in flight shows a
 * skeleton the height of the figure, a failed read shows the word
 * "unavailable" with its dot — never a "0" or a dash standing in for a fact.
 * Page-local to History and Timeline; a candidate for metric-band.tsx.
 */
import type { ReactNode } from "react";

import { EvidenceDot } from "@/components/evidence";
import { Skeleton } from "@/components/ui/misc";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

/** A figure whose read failed: the state word with its dot, never a zero. */
export function UnavailableFigure() {
  return (
    <span
      className={cn(
        typeClass("body"),
        "inline-flex items-center gap-1.5 text-foreground",
      )}
    >
      <EvidenceDot state="unavailable" />
      unavailable
    </span>
  );
}

/** A figure still being read: a skeleton the height of the title line. */
export function PendingFigure() {
  return (
    <span role="status" aria-label="Loading" className="flex h-7 items-center">
      <Skeleton className="h-4 w-16" />
    </span>
  );
}

export type Read<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly value: T };

export function figure<T>(
  read: Read<T>,
  show: (value: T) => ReactNode,
): ReactNode {
  if (read.state === "loading") {
    return <PendingFigure />;
  }
  if (read.state === "failed") {
    return <UnavailableFigure />;
  }
  return show(read.value);
}
