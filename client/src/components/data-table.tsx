/**
 * Evidence-table helpers shared by every page's own FF Table:
 *  - `EmptyRows`: the worded empty state of a list or table;
 *  - `activateOnKey` + `ROW_FOCUS_CLASS`: a clickable body row (it opens the
 *    row detail sheet) answers Enter / Space and shows a focus outline.
 *
 * The tables themselves follow FLUID.md: TYPE first, the four value-state
 * words from field-state.tsx, Commit State as a StateWord, FF `TableRow
 * index` for the fluid hover, `scroll-fade-x` on a wide scroller.
 */
import type { KeyboardEvent, ReactNode } from "react";

import { EmptyIcon, type AppIcon } from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

/**
 * The empty state of a list or table: a quiet icon, the reason in words, and
 * an optional next step. `message` alone keeps the earlier one-line form.
 */
export function EmptyRows({
  message,
  title,
  icon: Icon = EmptyIcon,
  action,
  className,
}: {
  /** What is (not) here, in plain words. */
  readonly message: ReactNode;
  /** Optional heading above the message (subtitle role). */
  readonly title?: ReactNode;
  /** Optional icon in place of the inbox. */
  readonly icon?: AppIcon;
  /** Optional next step, e.g. a tertiary "Clear filter" Button. */
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  const size = useSize();
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mb-1 inline-flex size-9 items-center justify-center rounded-lg bg-hover text-muted-foreground"
      >
        <Icon size={size.icon} strokeWidth={1.5} />
      </span>
      {title === undefined ? null : (
        <p
          className={cn(size.type.subtitle, "text-foreground")}
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {title}
        </p>
      )}
      <p className={cn(size.type.body, "max-w-sm text-muted-foreground")}>
        {message}
      </p>
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Enter / Space on a focused row opens it, like a click. */
export function activateOnKey(
  event: KeyboardEvent<HTMLTableRowElement>,
  activate: () => void,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activate();
  }
}

/** Focus ring for a clickable row (rows can't take a box-shadow ring). */
export const ROW_FOCUS_CLASS =
  "cursor-pointer outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[color:var(--focus-ring,#6B97FF)]";
