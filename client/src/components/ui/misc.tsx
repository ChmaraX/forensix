/**
 * Small primitives Fluid Functionalism does not ship as their own items,
 * written to its rules: sizes from the shared ladder (`useSize`), type from
 * the six roles, state fills from `bg-hover` / `bg-active`, the 1px
 * `--border` ring as an outer shadow (like the tertiary Button), the token
 * focus ring, and 80ms color transitions (FF's interaction timing).
 *
 * Exports keep their earlier names so pages compile unchanged:
 *  - Skeleton  — FF's (shadcn) Skeleton, hidden from assistive tech.
 *  - Input     — a native text field on the control height. Prefer FF's
 *                InputGroup for labelled form fields.
 *  - SelectNative — a native <select> on the control height. Prefer FF's
 *                Select (custom popup) for new filters.
 *  - Chip      — a pressed/unpressed toggle. Prefer FF's CheckboxGroup or
 *                TabsSubtle when the chips form one set of choices.
 *  - Labeled   — a caption label above a control.
 *  - Kbd       — a keyboard cap (micro role), as in FF's sidebar and menus.
 */
import { Check, ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Skeleton as FluidSkeleton } from "@/components/ui/skeleton";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

export function Skeleton(props: ComponentProps<typeof FluidSkeleton>) {
  return <FluidSkeleton aria-hidden="true" {...props} />;
}

const FIELD_CHROME =
  "bg-transparent text-foreground shadow-[0_0_0_1px_var(--border)] outline-none transition-[background-color,box-shadow] duration-80 placeholder:text-muted-foreground hover:bg-hover focus-visible:bg-card focus-visible:shadow-[0_0_0_1px_var(--focus-ring,#6B97FF)] disabled:pointer-events-none disabled:opacity-50";

export function Input({ className, ...props }: ComponentProps<"input">) {
  const size = useSize();
  const shape = useShape();
  return (
    <input
      className={cn(
        size.control,
        size.px,
        size.field,
        shape.input,
        FIELD_CHROME,
        "min-w-0",
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
  const size = useSize();
  const shape = useShape();
  return (
    <div className={cn("relative", wrapperClassName)}>
      <select
        className={cn(
          size.control,
          size.field,
          shape.input,
          FIELD_CHROME,
          "w-full cursor-pointer appearance-none pr-8 pl-3",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        size={size.icon}
        strokeWidth={1.5}
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground"
      />
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
  const shape = useShape();
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1 px-2.5 whitespace-nowrap outline-none",
        typeClass("caption"),
        shape.item,
        "transition-[background-color,color,box-shadow] duration-80",
        "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
        active
          ? "bg-active text-foreground shadow-[0_0_0_1px_transparent]"
          : "text-muted-foreground shadow-[0_0_0_1px_var(--border)] hover:bg-hover hover:text-foreground",
      )}
    >
      {active ? <Check aria-hidden="true" size={12} strokeWidth={2} /> : null}
      {/* Ghost-span: the semibold copy reserves width so pressing never
          shifts the row. */}
      <span className="inline-grid">
        <span
          className="col-start-1 row-start-1 transition-[font-variation-settings] duration-80"
          style={{
            fontVariationSettings: active
              ? fontWeights.semibold
              : fontWeights.normal,
          }}
        >
          {children}
        </span>
        <span
          aria-hidden="true"
          className="invisible col-start-1 row-start-1"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {children}
        </span>
      </span>
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
        className={cn(typeClass("caption"), "text-muted-foreground")}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center font-sans text-muted-foreground",
        typeClass("micro"),
        className,
      )}
      {...props}
    />
  );
}
