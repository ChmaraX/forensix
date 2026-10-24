/**
 * The framed home of a chart: an FF `Panel` (one surface step above the page
 * column) with the panel title (and an optional description under it) on
 * the left and the chart's controls on the right. Controls sit in a compact `SizeProvider`, the size
 * step FF uses for toolbars, so a range picker, a segmented toggle, and a
 * button placed there all share the 28px ladder without per-control props.
 */
import { useId, type ReactNode } from "react";

import {
  Panel,
  PanelDescription,
  PanelFooter,
  PanelHeader,
  PanelTitle,
} from "@/components/panel";
import { SizeProvider, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

export function ChartSection({
  title,
  description,
  action,
  children,
  className,
  footer,
}: {
  readonly title: string;
  /** Only when it adds information the title does not carry. */
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  /** Optional: a quiet strip under the chart (a legend, a truncation note),
   *  drawn as a `PanelFooter` hairline row. */
  readonly footer?: ReactNode;
}) {
  const titleId = useId();
  return (
    <Panel
      role="region"
      aria-labelledby={titleId}
      className={cn("overflow-hidden", className)}
    >
      <PanelHeader className="items-center pb-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle id={titleId}>{title}</PanelTitle>
          {description === undefined ? null : (
            <PanelDescription>{description}</PanelDescription>
          )}
        </div>
        {action === undefined ? null : (
          <SizeProvider size="compact">
            <ChartActions>{action}</ChartActions>
          </SizeProvider>
        )}
      </PanelHeader>
      {children}
      {footer === undefined ? null : (
        <PanelFooter className="flex-wrap gap-x-4 gap-y-1">
          {footer}
        </PanelFooter>
      )}
    </Panel>
  );
}

function ChartActions({ children }: { readonly children: ReactNode }) {
  const size = useSize();
  return (
    <div className={cn("ml-auto flex shrink-0 items-center", size.gap)}>
      {children}
    </div>
  );
}
