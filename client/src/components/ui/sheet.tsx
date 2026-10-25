/**
 * Sheet — a side panel in Fluid Functionalism's style. FF ships no sheet, so
 * this composes the same parts as its Dialog and its Sidebar's mobile drawer:
 *
 *  - Radix Dialog for focus trap, focus restore, scroll lock, Escape and
 *    outside press;
 *  - motion for the slide: a panel that must land exactly rides
 *    `spring.moderate` (critically damped, no overshoot past the edge) and
 *    leaves on its quicker exit tween; the scrim fades on the same tier.
 *    Reduced motion drops the slide and keeps the fade. The portal stays
 *    mounted until the exit finishes (with FF's timed fallback);
 *  - the dialog elevation: 4 surface steps above the substrate, re-provided
 *    so popups opened inside walk further up the ladder;
 *  - an inset, floating panel with the shape system's container radius, like
 *    the app's own inset content area, and FF's ghost ✕ in the corner.
 *
 * Exports keep the earlier names (Sheet, SheetContent, SheetTitle,
 * SheetDescription) and add SheetTrigger / SheetClose / SheetHeader /
 * SheetBody / SheetFooter.
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
} from "react";

import { Button } from "@/components/ui/button";
import { fontWeights } from "@/lib/font-weight";
import { useIcons } from "@/lib/icon-context";
import { useShape } from "@/lib/shape-context";
import { typeClass, useSizeVariant } from "@/lib/size-context";
import { spring, exitFallbackMs } from "@/lib/springs";
import { surfaceClasses } from "@/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@/lib/surface-context";
import { cn } from "@/lib/utils";

const SHEET_OFFSET = 4;

const SheetOpenContext = createContext(false);

/** Root. Tracks open state itself so the panel can play its exit. */
function Sheet({
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: DialogPrimitive.DialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    defaultOpen ?? false,
  );
  const open = controlledOpen ?? uncontrolledOpen;
  return (
    <SheetOpenContext.Provider value={open}>
      <DialogPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          setUncontrolledOpen(next);
          onOpenChange?.(next);
        }}
        {...props}
      >
        {children}
      </DialogPrimitive.Root>
    </SheetOpenContext.Provider>
  );
}

const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

interface SheetContentProps extends ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /** Edge the panel slides in from. @default "right" */
  side?: "left" | "right";
  /** The ghost ✕ in the top corner. @default true */
  showCloseButton?: boolean;
}

const SheetContent = forwardRef<HTMLDivElement, SheetContentProps>(
  (
    {
      side = "right",
      showCloseButton = true,
      className,
      children,
      onOpenAutoFocus,
      ...props
    },
    ref,
  ) => {
    const open = useContext(SheetOpenContext);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const reduceMotion = useReducedMotion() ?? false;
    const shape = useShape();
    const icons = useIcons();
    const XIcon = icons.x;
    const level = Math.min(useSurface() + SHEET_OFFSET, 8);
    const [mounted, setMounted] = useState(false);
    if (open && !mounted) {
      setMounted(true);
    }
    useEffect(() => {
      if (open) {
        return;
      }
      const id = setTimeout(() => {
        setMounted(false);
      }, exitFallbackMs(spring.moderate));
      return () => {
        clearTimeout(id);
      };
    }, [open]);

    if (!mounted) {
      return null;
    }

    // Off-screen by its own width plus the 8px inset, so it fully clears.
    const offscreen =
      side === "left" ? "calc(-100% - 8px)" : "calc(100% + 8px)";

    return (
      <DialogPrimitive.Portal forceMount>
        <DialogPrimitive.Overlay asChild forceMount>
          <motion.div
            className="fixed inset-0 z-50 bg-black/40 dark:bg-black/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: open ? 1 : 0 }}
            transition={
              open
                ? { duration: spring.moderate.duration }
                : spring.moderate.exit
            }
          />
        </DialogPrimitive.Overlay>
        <DialogPrimitive.Content
          ref={(node) => {
            panelRef.current = node;
            if (typeof ref === "function") {
              ref(node);
            } else if (ref !== null) {
              ref.current = node;
            }
          }}
          asChild
          forceMount
          // The panel takes initial focus itself (as FF's drawer does): left
          // to Radix, focus lands on the first focusable child, which shows
          // its tooltip or focus ring the moment the sheet opens.
          onOpenAutoFocus={(event) => {
            onOpenAutoFocus?.(event);
            if (!event.defaultPrevented) {
              event.preventDefault();
              panelRef.current?.focus();
            }
          }}
          {...props}
        >
          <motion.div
            tabIndex={-1}
            className={cn(
              "fixed inset-y-2 z-50 flex w-[calc(100%-16px)] max-w-[460px] flex-col overflow-hidden text-foreground outline-none",
              side === "left" ? "left-2" : "right-2",
              surfaceClasses(level),
              shape.container,
              className,
            )}
            initial={{ x: offscreen }}
            animate={{ x: open ? 0 : offscreen }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : open
                  ? spring.moderate
                  : spring.moderate.exit
            }
            onAnimationComplete={() => {
              if (!open) {
                setMounted(false);
              }
            }}
          >
            <SurfaceProvider value={level}>
              {children}
              {showCloseButton ? (
                <DialogPrimitive.Close asChild>
                  <Button
                    variant="ghost"
                    size="icon-compact"
                    // 28px for a mouse, 40px on touch (the header makes
                    // room for it: pr-12, pr-14 on touch).
                    className="absolute top-3 right-3 pointer-coarse:size-10"
                  >
                    <XIcon />
                    <span className="sr-only">Close</span>
                  </Button>
                </DialogPrimitive.Close>
              ) : null}
            </SurfaceProvider>
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);
SheetContent.displayName = "SheetContent";

/** Title + description stack; leaves room for the corner ✕. */
function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 py-4 pr-12 pl-5 pointer-coarse:pr-14",
        className,
      )}
      {...props}
    />
  );
}

/** The scrolling region under the header. */
function SheetBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto px-5 pb-5", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex justify-end gap-2 border-t border-border px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}

const SheetTitle = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, style, ...props }, ref) => {
  const compact = useSizeVariant() === "compact";
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn(
        typeClass("title", compact ? "compact" : "default"),
        "text-foreground",
        className,
      )}
      style={{ fontVariationSettings: fontWeights.semibold, ...style }}
      {...props}
    />
  );
});
SheetTitle.displayName = "SheetTitle";

const SheetDescription = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => {
  const compact = useSizeVariant() === "compact";
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn(
        typeClass("body", compact ? "compact" : "default"),
        "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
});
SheetDescription.displayName = "SheetDescription";

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
export type { SheetContentProps };
