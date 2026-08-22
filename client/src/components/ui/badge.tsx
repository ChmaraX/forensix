import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib.js";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-muted text-foreground/80",
        outline: "border-border bg-card text-muted-foreground",
        accent: "border-accent-border bg-accent text-accent-foreground",
        wal: "border-wal-border bg-wal-wash text-wal",
        violet: "border-violet-border bg-violet-wash text-violet",
        destructive:
          "border-destructive-border bg-destructive-wash text-destructive",
        success: "border-success-border bg-success-wash text-success",
      },
    },
    defaultVariants: { variant: "outline" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
