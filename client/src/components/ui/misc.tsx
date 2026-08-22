/** Small shadcn-style primitives: skeleton, input, native select, chip. */
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib.js";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-8 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground transition-colors duration-150 placeholder:text-muted-foreground/70 hover:border-muted-foreground/40",
        className,
      )}
      {...props}
    />
  );
}

export function SelectNative({
  className,
  wrapperClassName,
  children,
  ...props
}: ComponentProps<"select"> & { readonly wrapperClassName?: string }) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <select
        className={cn(
          "h-8 w-full cursor-pointer appearance-none rounded-md border border-border bg-card pr-7 pl-2.5 text-[13px] text-foreground transition-colors duration-150 hover:border-muted-foreground/40",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 stroke-muted-foreground"
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    </div>
  );
}

export function Chip({
  children,
  active,
  onClick,
}: {
  readonly children: ReactNode;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-150",
        active
          ? "border-primary bg-accent text-accent-foreground"
          : "border-border bg-card text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
      )}
    >
      {active ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-3 stroke-primary"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      ) : null}
      {children}
    </button>
  );
}

export function Labeled({
  label,
  htmlFor,
  children,
}: {
  readonly label: ReactNode;
  readonly htmlFor?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-medium tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
