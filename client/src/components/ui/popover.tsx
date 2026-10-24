/**
 * Popover — Fluid Functionalism ships no standalone popover, so this one is
 * built from the same parts as its Dropdown popup, so it opens and sits like
 * every other FF popup:
 *
 *  - Radix Popover for anchoring, focus handling, Escape and outside press;
 *  - the shared popup motion: opacity + scaleY 0.96 + a 4px slide toward the
 *    trigger from the resolved side (`popupMotionClass`), entering on
 *    `spring.fast` and leaving on its quicker exit tween, with the portal
 *    kept mounted until the exit finishes;
 *  - `Elevated offset={2} shadowLevel={3}`: two steps above whatever surface
 *    it opens on (page, panel, dialog), with a constant popup shadow;
 *  - the "rounded" shape pair regardless of the app shape, like Dropdown
 *    (12px container), and FF's 4px popup padding by default.
 *
 * Same exports and props as the earlier shadcn-style popover, so call sites
 * keep working: Popover, PopoverTrigger, PopoverAnchor, PopoverContent.
 */
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { motion } from "motion/react";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
} from "react";

import { Elevated } from "@/lib/elevated";
import { popupMotionClass } from "@/lib/popup";
import { shapeMap } from "@/lib/shape-context";
import { spring, exitFallbackMs } from "@/lib/springs";
import { cn } from "@/lib/utils";

const PopoverOpenContext = createContext(false);

/** Root. Tracks open state itself so the content can play its exit. */
function Popover({
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    defaultOpen ?? false,
  );
  const open = controlledOpen ?? uncontrolledOpen;
  return (
    <PopoverOpenContext.Provider value={open}>
      <PopoverPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          setUncontrolledOpen(next);
          onOpenChange?.(next);
        }}
        {...props}
      >
        {children}
      </PopoverPrimitive.Root>
    </PopoverOpenContext.Provider>
  );
}

const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

interface PopoverContentProps extends ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
> {
  /** Drop the default 4px popup padding (e.g. for a calendar). */
  flush?: boolean;
}

const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
  (
    {
      className,
      children,
      align = "start",
      sideOffset = 8,
      flush = false,
      ...props
    },
    ref,
  ) => {
    const open = useContext(PopoverOpenContext);
    const [mounted, setMounted] = useState(false);
    // Mount in the same render that opens it.
    if (open && !mounted) {
      setMounted(true);
    }
    // Fallback release for the deferred unmount (a throttled tab can stall
    // onAnimationComplete), derived from the exit token like FF's popups.
    useEffect(() => {
      if (open) {
        return;
      }
      const id = setTimeout(() => {
        setMounted(false);
      }, exitFallbackMs(spring.fast));
      return () => {
        clearTimeout(id);
      };
    }, [open]);

    if (!mounted) {
      return null;
    }

    return (
      <PopoverPrimitive.Portal forceMount>
        <PopoverPrimitive.Content
          asChild
          forceMount
          align={align}
          sideOffset={sideOffset}
          {...props}
        >
          <motion.div
            className={cn("z-50 outline-none", popupMotionClass)}
            initial={{ opacity: 0, y: "var(--popup-enter-y)", scaleY: 0.96 }}
            animate={
              open
                ? { opacity: 1, y: 0, scaleY: 1 }
                : { opacity: 0, y: "var(--popup-enter-y)", scaleY: 0.96 }
            }
            transition={open ? spring.fast : spring.fast.exit}
            onAnimationComplete={() => {
              if (!open) {
                setMounted(false);
              }
            }}
          >
            <Elevated
              ref={ref}
              offset={2}
              shadowLevel={3}
              className={cn(
                "text-foreground",
                shapeMap.rounded.container,
                flush ? "" : "p-1",
                className,
              )}
            >
              {children}
            </Elevated>
          </motion.div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
export type { PopoverContentProps };
