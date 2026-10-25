/**
 * Term — a forensic term with a plain-language tooltip.
 *
 * The label carries a dotted underline (the cue that it explains itself) and
 * takes focus, so keyboard users reach the same explanation. The tooltip is
 * FF's (inverted bubble, `spring.fast` in, quicker exit, grouped skip-delay
 * under the app's TooltipProvider), widened for a sentence or two. The
 * optional `technical` line names the exact analyzer term (proportional —
 * it is a name, not a value to copy).
 */
import type { ReactElement, ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Tooltip body: the explanation, then the exact technical term. */
export function TermExplanation({
  children,
  technical,
}: {
  readonly children: ReactNode;
  readonly technical?: ReactNode;
}) {
  return (
    <span className="block">
      {children}
      {technical === undefined ? null : (
        <span className="mt-1 block">{technical}</span>
      )}
    </span>
  );
}

/** A focusable, dotted-underlined label whose tooltip explains it. */
export function Term({
  label,
  children,
  technical,
  className,
}: {
  readonly label: ReactNode;
  readonly children: ReactNode;
  readonly technical?: ReactNode;
  readonly className?: string;
}) {
  return (
    <TermTooltip
      content={
        <TermExplanation technical={technical}>{children}</TermExplanation>
      }
    >
      <span
        tabIndex={0}
        className={cn(
          "term-trigger cursor-help underline decoration-muted-foreground decoration-dotted underline-offset-2",
          className,
        )}
      >
        {label}
      </span>
    </TermTooltip>
  );
}

/** FF Tooltip sized for explanatory text (max ~280px, wraps). */
export function TermTooltip({
  content,
  children,
}: {
  readonly content: ReactNode;
  readonly children: ReactElement;
}) {
  return (
    <Tooltip content={content} className="max-w-[280px] whitespace-normal">
      {children}
    </Tooltip>
  );
}
