/**
 * COMPATIBILITY SHIM — delete once no page imports it.
 *
 * Pre-FF call sites wrote `<Button size="sm">` with no variant and got a
 * bordered ("outline") button. FF's Button (components/ui/button.tsx)
 * defaults to `primary`, a solid foreground fill meant for the one main
 * action. This shim keeps the old names and defaults and draws them with
 * the FF Button:
 *
 *   variant  default → primary · outline (old default) → tertiary
 *            ghost → ghost · pill → tertiary (FF shapes come from the
 *            shape system, not the variant)
 *   size     default → follows the SizeProvider (36px, or 28px compact)
 *            sm → compact · icon → icon-compact
 *
 * FF variants and sizes pass straight through. Migrate a call site by
 * importing `Button` from `@/components/ui/button` and choosing a variant
 * (see FLUID.md).
 */
import { forwardRef, type ComponentProps } from "react";

import { Button as FluidButton } from "@/components/ui/button";

type FluidButtonProps = ComponentProps<typeof FluidButton>;
type FluidVariant = NonNullable<FluidButtonProps["variant"]>;
type FluidSize = NonNullable<FluidButtonProps["size"]>;

type LegacyVariant = "default" | "outline" | "ghost" | "pill";
type LegacySize = "default" | "sm" | "icon";

export interface ButtonProps extends Omit<
  FluidButtonProps,
  "variant" | "size"
> {
  readonly variant?: LegacyVariant | FluidVariant;
  readonly size?: LegacySize | FluidSize;
}

const VARIANTS: Record<LegacyVariant, FluidVariant> = {
  default: "primary",
  outline: "tertiary",
  ghost: "ghost",
  pill: "tertiary",
};

const SIZES: Record<LegacySize, FluidSize | undefined> = {
  default: undefined,
  sm: "compact",
  icon: "icon-compact",
};

function isLegacyVariant(value: string): value is LegacyVariant {
  return value in VARIANTS;
}

function isLegacySize(value: string): value is LegacySize {
  return value in SIZES;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "outline", size, type, ...props }, ref) {
    return (
      <FluidButton
        ref={ref}
        type={type ?? "button"}
        variant={isLegacyVariant(variant) ? VARIANTS[variant] : variant}
        size={size !== undefined && isLegacySize(size) ? SIZES[size] : size}
        {...props}
      />
    );
  },
);
