import type { ComponentProps } from "react";

import { cn } from "../../lib.js";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border bg-card text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Title and description stack; an optional trailing action (the Overview's
 * per-panel jump link) sits on the header's right edge. The stacked pair —
 * not an icon chip — is what identifies a panel.
 */
export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 px-5 pt-[18px] pb-2",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "text-[15px] leading-tight font-semibold tracking-[-0.015em]",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "text-[12.5px] leading-snug text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}
