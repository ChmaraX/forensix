/**
 * The framed home of a chart: an FF `Panel` (one surface step above the page
 * column) with the panel title and description on the left and the chart's
 * controls on the right. Controls sit in a compact `SizeProvider`, the size
 * step FF uses for toolbars, so a range picker, a segmented toggle, and a
 * button placed there all share the 28px ladder without per-control props.
 *
 * `ChartToggle` is the segmented control for 2–4 mutually exclusive chart
 * views (bytes / count, day / week, saved / recovered): FF `Tabs`, so the
 * active pill travels on `spring.moderate` and labels change weight without
 * shifting.
 */
import { useId, type ReactNode } from "react";

import {
  Panel,
  PanelDescription,
  PanelFooter,
  PanelHeader,
  PanelTitle,
} from "@/components/panel";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
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
  readonly description: string;
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
        <div className="min-w-0">
          <PanelTitle id={titleId}>{title}</PanelTitle>
          <PanelDescription>{description}</PanelDescription>
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

export interface ChartToggleOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Segmented control for a chart's view (FF `Tabs`). Follows the surrounding
 * size: compact inside a `ChartSection` action, default elsewhere.
 */
export function ChartToggle({
  options,
  value,
  onChange,
  label,
  className,
}: {
  readonly options: readonly ChartToggleOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Accessible name of the control, e.g. "Chart measure". */
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <Tabs value={value} onValueChange={onChange} className={className}>
      <TabsList aria-label={label}>
        {options.map((option) => (
          <TabItem
            key={option.value}
            value={option.value}
            label={option.label}
          />
        ))}
      </TabsList>
    </Tabs>
  );
}
