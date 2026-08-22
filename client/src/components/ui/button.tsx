import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs",
        outline:
          "border border-border bg-card text-foreground hover:bg-muted/60",
        ghost: "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        pill: "rounded-full border border-border bg-card text-foreground hover:bg-muted/60",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 rounded-md px-2.5 text-[12px]",
        icon: "size-8",
      },
    },
    defaultVariants: { variant: "outline", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  type,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      type={type ?? "button"}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
