/**
 * Panel — the dashboard's section surface (stat bands, charts, tables).
 *
 * FF's own Card is transparent and borderless by design (it leans on the
 * parent substrate and hairlines), which suits card grids and lists but not a
 * framed dashboard section. A Panel is the FF surface system applied to that
 * job: `Elevated offset={1}` lifts it one step above the substrate (the app
 * shell provides surface 2 for the content area, so panels land on surface 3
 * with its paired shadow, and popups opened inside walk up from there), the
 * shape system's container radius (12px), and the type roles for its header.
 *
 * Nested surfaces inside a Panel follow FF's concentric rule: an element
 * inset 4px uses the 8px `bg` radius (`rounded-lg`); any other inset uses
 * `nestedRadius(12, inset)` from `@/lib/shape-context`.
 */
import { forwardRef, type ComponentProps, type HTMLAttributes } from "react";

import { Elevated } from "@/lib/elevated";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { typeClass, useSizeVariant } from "@/lib/size-context";
import { cn } from "@/lib/utils";

export const Panel = forwardRef<
  HTMLDivElement,
  Omit<ComponentProps<typeof Elevated>, "offset">
>(function Panel({ className, ...props }, ref) {
  const shape = useShape();
  return (
    <Elevated
      ref={ref}
      offset={1}
      className={cn(
        "flex min-w-0 flex-col text-foreground",
        shape.container,
        className,
      )}
      {...props}
    />
  );
});

/** Title + description on the left, an optional action on the right. */
export function PanelHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 pb-2",
        className,
      )}
      {...props}
    />
  );
}

/** A heading element level for a panel title (`h2` under the page title). */
export type HeadingTag = "h2" | "h3" | "h4" | "h5";

export function PanelTitle({
  as: Heading = "h2",
  className,
  style,
  ...props
}: HTMLAttributes<HTMLHeadingElement> & {
  /** The heading element. @default "h2" */
  readonly as?: HeadingTag;
}) {
  const compact = useSizeVariant() === "compact";
  return (
    <Heading
      className={cn(
        typeClass("subtitle", compact ? "compact" : "default"),
        "text-foreground",
        className,
      )}
      style={{ fontVariationSettings: fontWeights.semibold, ...style }}
      {...props}
    />
  );
}

export function PanelDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  const compact = useSizeVariant() === "compact";
  return (
    <p
      className={cn(
        typeClass("body", compact ? "compact" : "default"),
        "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function PanelContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-4", className)} {...props} />;
}

export function PanelFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-border px-4 py-2.5",
        className,
      )}
      {...props}
    />
  );
}
