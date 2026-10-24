"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  createContext,
  useContext,
  forwardRef,
  Children,
  cloneElement,
  isValidElement,
  type ComponentPropsWithoutRef,
} from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion, AnimatePresence } from "motion/react";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/springs";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { SizeProvider, useSize, type SizeVariant } from "@/lib/size-context";
import { useSurface } from "@/lib/surface-context";
import { surfaceClasses } from "@/lib/surface-classes";
import { useFluidHover } from "@/hooks/use-fluid-hover";

// ---------------------------------------------------------------------------
// Tabs is a segmented control: a muted track (TabsList) holding one raised
// pill for the selected tab, a faint hover pill that previews the next click,
// and a focus ring for the keyboard. All three are absolutely positioned
// layers that travel across the tab rects measured by useFluidHover; the tabs
// themselves stay transparent. Selection moves on spring.moderate, hover and
// focus on spring.fast, and labels change weight without shifting layout.
// ---------------------------------------------------------------------------

/* ─────────────────────── Contexts ─────────────────────── */

interface TabsValueOrderContextValue {
  valueOrder: string[];
  setValueOrder: (order: string[]) => void;
  selectedValue: string | undefined;
}

const TabsValueOrderContext = createContext<TabsValueOrderContextValue | null>(null);

interface TabsListContextValue {
  registerTab: (index: number, value: string, el: HTMLElement | null) => void;
  hoveredIndex: number | null;
  selectedValue: string | undefined;
  /** Optimistically set selectedIdx so the indicator moves immediately on click. */
  setOptimisticIdx: (index: number) => void;
}

const TabsListContext = createContext<TabsListContextValue | null>(null);

function useTabsList() {
  const ctx = useContext(TabsListContext);
  if (!ctx) throw new Error("TabItem must be used within a TabsList");
  return ctx;
}

/* ─────────────────────── Tabs (Root) ─────────────────────── */

interface TabsProps
  extends Omit<
    ComponentPropsWithoutRef<typeof TabsPrimitive.Root>,
    "onValueChange" | "onSelect"
  > {
  /** Controlled value (takes precedence over selectedIndex). */
  value?: string;
  /** Called when the active tab changes. */
  onValueChange?: (value: string) => void;
  /** Index-based controlled alternative. */
  selectedIndex?: number;
  /** Called with the new index when the active tab changes. */
  onSelect?: (index: number) => void;
  /** Pins the segmented control to one step of the size ladder (default 36px
   *  outer, compact 28px). Omitted, it follows the
   *  surrounding SizeProvider. */
  size?: SizeVariant;
}

const Tabs = forwardRef<HTMLDivElement, TabsProps>(
  (
    {
      value,
      onValueChange,
      selectedIndex,
      onSelect,
      defaultValue,
      size,
      children,
      ...props
    },
    ref
  ) => {
    const [valueOrder, setValueOrder] = useState<string[]>([]);
    const [uncontrolledValue, setUncontrolledValue] = useState<string | undefined>(
      defaultValue
    );
    // Keep the current array when the order is unchanged: React then bails
    // out of the update, so a TabsList re-reporting the same tabs (a remount,
    // Strict Mode's double effects) doesn't re-render the whole root.
    const updateValueOrder = useCallback((order: string[]) => {
      setValueOrder((current) => {
        if (
          current.length === order.length &&
          current.every((value, index) => value === order[index])
        ) {
          return current;
        }
        return order;
      });
    }, []);

    // Resolve value: explicit value > selectedIndex lookup > uncontrolled state.
    // Uncontrolled with no defaultValue falls back to the first tab so the
    // FF layer's selectedValue matches what the primitive shows.
    const resolvedValue =
      value ??
      (selectedIndex != null
        ? valueOrder[selectedIndex]
        : uncontrolledValue ?? valueOrder[0]);

    const handleValueChange = useCallback(
      (newValue: string) => {
        // Local state only backs uncontrolled use. With value or selectedIndex
        // the parent owns selection, so this just reports the change, by value
        // and by index.
        if (value === undefined && selectedIndex == null) {
          setUncontrolledValue(newValue);
        }
        onValueChange?.(newValue);
        if (onSelect) {
          const idx = valueOrder.indexOf(newValue);
          if (idx !== -1) onSelect(idx);
        }
      },
      [onValueChange, onSelect, valueOrder, value, selectedIndex]
    );

    const root = (
      <TabsValueOrderContext.Provider
        value={{
          valueOrder,
          setValueOrder: updateValueOrder,
          selectedValue: resolvedValue,
        }}
      >
        {/*
          Always controlled: feeding the primitive an undefined-then-defined
          value flips it from uncontrolled to controlled, which Radix warns
          about in dev. valueOrder is empty on the first commit, so fall back
          to an empty-string sentinel — TabsList's layout effect populates
          valueOrder pre-paint, so the corrected value lands before anything
          is visible.
        */}
        <TabsPrimitive.Root
          ref={ref}
          value={resolvedValue ?? ""}
          onValueChange={handleValueChange}
          // Arrow keys move focus and select in one step, so the pill follows
          // the keyboard the same way it follows a click.
          activationMode="automatic"
          {...props}
        >
          {children}
        </TabsPrimitive.Root>
      </TabsValueOrderContext.Provider>
    );

    // A size prop pins the whole compound (list + items) to one ladder step.
    return size ? <SizeProvider size={size}>{root}</SizeProvider> : root;
  }
);

Tabs.displayName = "Tabs";

/* ─────────────────────── TabsList ─────────────────────── */

type TabsListProps = ComponentPropsWithoutRef<typeof TabsPrimitive.List>;

const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  ({ children, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    // Whether the pointer is over the list: a ref for blur, which reads it at
    // the moment it runs, and the same flag as state for the render, which
    // picks the hover pill's exit from it. Both flip in the same handlers.
    const isMouseInside = useRef(false);
    const [mouseInside, setMouseInside] = useState(false);
    const shape = useShape();
    const sizeClasses = useSize();
    const substrate = useSurface();
    // Active pill lifts 3 levels above substrate (1 above the muted track + 2 for pop).
    // On the page (substrate 1) this lands on surface 4, the original design.
    // Inside a dialog (substrate 5) it lifts to surface 8 instead of staying at 4.
    const indicatorLevel = Math.min(substrate + 3, 8);
    const valueOrderCtx = useContext(TabsValueOrderContext);

    // Derive value order from children synchronously
    const values = Children.toArray(children)
      .filter(isValidElement)
      .map((child) => (child.props as { value?: string }).value)
      .filter((v): v is string => typeof v === "string");
    // `values` is a new array every render; the serialized key is what the
    // layout effect compares, so it only re-reports on a real change.
    const valueOrderKey = JSON.stringify(values);
    const setValueOrder = valueOrderCtx?.setValueOrder;

    // Report value order up to Tabs root
    useLayoutEffect(() => {
      setValueOrder?.(JSON.parse(valueOrderKey) as string[]);
    }, [setValueOrder, valueOrderKey]);

    // Fluid hover
    // axis "x": the tab nearest the cursor horizontally wins, so the list's
    // padding never leaves the hover pill without a target.
    const {
      activeIndex: hoveredIndex,
      setActiveIndex: setHoveredIndex,
      itemRects,
      handlers,
      registerItem,
      measureItems,
    } = useFluidHover(containerRef, { axis: "x" });

    // Register items: bridge from (index, value, el) → registerItem(index, el)
    const registerTab = useCallback(
      (index: number, _value: string, el: HTMLElement | null) => {
        registerItem(index, el);
      },
      [registerItem]
    );

    // Measure on children change (resizes are covered by useFluidHover's
    // own container ResizeObserver)
    useEffect(() => {
      measureItems();
    }, [measureItems, children]);

    // Track mouse inside
    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        isMouseInside.current = true;
        setMouseInside(true);
        handlers.onMouseMove(e);
      },
      [handlers]
    );

    // Flip the flag before clearing the hover index: the hover pill's exit is
    // chosen from it, sliding back into the selected pill or fading in place.
    const handleMouseLeave = useCallback(() => {
      isMouseInside.current = false;
      setMouseInside(false);
      handlers.onMouseLeave();
    }, [handlers]);

    // Focus ring
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const selectedValue = valueOrderCtx?.selectedValue;
    const selectedIdx =
      selectedValue !== undefined ? values.indexOf(selectedValue) : -1;

    // The pills follow optimisticIdx, not selectedIdx. A click sets it at once,
    // so the pill moves before controlled state round-trips; it is then
    // resynced, during render, whenever the resolved selection changes (arrow
    // keys, a parent). The first render syncs too: syncedIdx starts unset.
    const [optimisticIdx, setOptimisticIdx] = useState<number | null>(null);
    const [syncedIdx, setSyncedIdx] = useState<number | undefined>(undefined);
    if (syncedIdx !== selectedIdx) {
      setSyncedIdx(selectedIdx);
      setOptimisticIdx(selectedIdx >= 0 ? selectedIdx : null);
    }

    const activeSelectedIdx = optimisticIdx;
    const selectedRect =
      activeSelectedIdx !== null ? itemRects[activeSelectedIdx] : null;
    const hoverRect = hoveredIndex !== null ? itemRects[hoveredIndex] : null;
    const focusRect = focusedIndex !== null ? itemRects[focusedIndex] : null;
    // Hovering the selected tab needs no hover pill (the active pill is already
    // there); hovering any other tab shows one and dims the active pill.
    const isHoveringSelected = hoveredIndex === activeSelectedIdx;
    const isHovering = hoveredIndex !== null && !isHoveringSelected;

    // Auto-assign _index to children.
    // Skip plain DOM elements: injecting _index into e.g. a <div>
    // triggers React's unknown-prop warning.
    const indexedChildren = Children.map(children, (child, i) => {
      if (isValidElement(child) && typeof child.type !== "string") {
        return cloneElement(child, { _index: i } as Record<string, unknown>);
      }
      return child;
    });

    return (
      <TabsListContext.Provider
        value={{
          registerTab,
          hoveredIndex,
          selectedValue,
          setOptimisticIdx,
        }}
      >
        <TabsPrimitive.List
          ref={(node) => {
            (
              containerRef as React.MutableRefObject<HTMLDivElement | null>
            ).current = node;
            if (typeof ref === "function") ref(node);
            else if (ref)
              (
                ref as React.MutableRefObject<HTMLDivElement | null>
              ).current = node;
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          // Focus also sets the hover index, so keyboard and mouse share one
          // highlight state. The ring draws only when the tab matches
          // :focus-visible, so a mouse click (which focuses too) shows none.
          onFocus={(e) => {
            const trigger = (e.target as HTMLElement).closest('[role="tab"]');
            if (!trigger) return;
            const indexAttr = trigger.getAttribute("data-fluid-hover-index");
            if (indexAttr != null) {
              const idx = Number(indexAttr);
              setHoveredIndex(idx);
              setFocusedIndex(
                (e.target as HTMLElement).matches(":focus-visible") ? idx : null
              );
            }
          }}
          // Focus moving between tabs stays inside the list and is ignored.
          // Leaving the list drops the ring, but the hover highlight stays
          // while the mouse still rests on a tab.
          onBlur={(e) => {
            if (containerRef.current?.contains(e.relatedTarget as Node)) return;
            setFocusedIndex(null);
            if (isMouseInside.current) return;
            setHoveredIndex(null);
          }}
          className={cn(
            // segmentPad + segmentItem add up to the ladder's control height
            // (36px default, 28px compact) so the segmented control's outer
            // box lines up with buttons, selects, and inputs beside it.
            "relative inline-flex items-center select-none bg-muted",
            sizeClasses.segmentPad,
            shape.container,
            className
          )}
          {...props}
        >
          {/* Active segment indicator */}
          {selectedRect && (
            <motion.div
              className={cn(
                "absolute pointer-events-none",
                // A raised surface (background + shadow), not a tint, so the
                // selected tab lifts off the muted track.
                surfaceClasses(indicatorLevel),
                shape.bg
              )}
              initial={false}
              animate={{
                left: selectedRect.left,
                width: selectedRect.width,
                top: selectedRect.top,
                height: selectedRect.height,
                // Dims to 0.85 while another tab is hovered: the selection
                // reads as "current" and the hover pill as "next".
                opacity: isHovering ? 0.85 : 1,
              }}
              // The selection travels on spring.moderate and lands without
              // overshoot; the dim is a plain 80ms fade.
              transition={{
                ...spring.moderate,
                opacity: { duration: 0.08 },
              }}
            />
          )}

          {/* Hover indicator */}
          <AnimatePresence>
            {/* Born at the selected pill (opacity 0) and sliding out to the
                hovered tab, so the preview reads as leaving the current
                choice. Without a selected pill there is nowhere to start. */}
            {hoverRect && !isHoveringSelected && selectedRect && (
              <motion.div
                className={cn(
                  "absolute pointer-events-none bg-hover",
                  shape.bg
                )}
                initial={{
                  left: selectedRect.left,
                  width: selectedRect.width,
                  top: selectedRect.top,
                  height: selectedRect.height,
                  opacity: 0,
                }}
                animate={{
                  left: hoverRect.left,
                  width: hoverRect.width,
                  top: hoverRect.top,
                  height: hoverRect.height,
                  // bg-hover at 0.4 stays well below the active pill.
                  opacity: 0.4,
                }}
                // With the mouse outside the list, slide back into the selected
                // pill on spring.moderate while fading over 60ms. With it still
                // inside (now over the selected tab), fade where it is.
                exit={
                  !mouseInside && selectedRect
                    ? {
                        left: selectedRect.left,
                        width: selectedRect.width,
                        top: selectedRect.top,
                        height: selectedRect.height,
                        opacity: 0,
                        transition: {
                          ...spring.moderate,
                          opacity: { duration: 0.06 },
                        },
                      }
                    : { opacity: 0, transition: spring.fast.exit }
                }
                // spring.fast so the preview keeps up with the cursor.
                transition={{
                  ...spring.fast,
                  opacity: { duration: 0.08 },
                }}
              />
            )}
          </AnimatePresence>

          {/* Focus ring */}
          <AnimatePresence>
            {/* One ring for the whole list that springs between tabs, drawn
                2px outside the focused tab's rect and above the tabs (z-20).
                The #6B97FF fallback keeps it visible without the token. */}
            {focusRect && (
              <motion.div
                className={cn(
                  "absolute pointer-events-none z-20 border border-[color:var(--focus-ring,#6B97FF)]",
                  shape.focusRing
                )}
                initial={false}
                animate={{
                  left: focusRect.left - 2,
                  top: focusRect.top - 2,
                  width: focusRect.width + 4,
                  height: focusRect.height + 4,
                }}
                exit={{ opacity: 0, transition: spring.fast.exit }}
                transition={{
                  ...spring.fast,
                  opacity: { duration: 0.08 },
                }}
              />
            )}
          </AnimatePresence>

          {indexedChildren}
        </TabsPrimitive.List>
      </TabsListContext.Provider>
    );
  }
);

TabsList.displayName = "TabsList";

/* ─────────────────────── TabItem ─────────────────────── */

interface TabItemProps
  extends ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  /** Unique value for this tab. */
  value: string;
  /** Optional leading icon. */
  icon?: IconComponent;
  /** Text label. */
  label: string;
  /** @internal Auto-assigned by TabsList. */
  _index?: number;
}

const TabItem = forwardRef<HTMLButtonElement, TabItemProps>(
  ({ value, icon: Icon, label, _index = 0, className, onClick, ...props }, ref) => {
    const internalRef = useRef<HTMLButtonElement>(null);
    const sizeClasses = useSize();
    const { registerTab, hoveredIndex, selectedValue, setOptimisticIdx } = useTabsList();

    // Register the button so the list can measure its rect; the cleanup
    // unregisters it so no pill aims at a tab that has gone.
    useEffect(() => {
      registerTab(_index, value, internalRef.current);
      return () => registerTab(_index, value, null);
    }, [_index, value, registerTab]);

    const isSelected = selectedValue === value;
    // Hover or selection brightens color and icon stroke; only selection
    // changes weight, so hovering never thickens a label.
    const isActive = hoveredIndex === _index || isSelected;

    return (
      <TabsPrimitive.Trigger
        // Composed (not spread-overridable): a consumer onClick must not
        // replace the optimistic indicator jump.
        onClick={(e) => {
          setOptimisticIdx(_index);
          onClick?.(e);
        }}
        ref={(node) => {
          (
            internalRef as React.MutableRefObject<HTMLButtonElement | null>
          ).current = node;
          if (typeof ref === "function") ref(node);
          else if (ref)
            (
              ref as React.MutableRefObject<HTMLButtonElement | null>
            ).current = node;
        }}
        value={value}
        // Read back by the list's onFocus to map a focused tab to its index.
        data-fluid-hover-index={_index}
        className={cn(
          // outline-none: the list draws one shared focus ring instead.
          // Fixed height (not py) so the text-box trim below doesn't shrink
          // the tab — browsers without text-box support render identically.
          "relative z-10 flex items-center px-3 cursor-pointer bg-transparent border-none outline-none",
          sizeClasses.segmentItem,
          sizeClasses.gap,
          className
        )}
        {...props}
      >
        {/* Stroke 1.5 → 2 and muted → foreground on hover or selection, over
            the label's 80ms, so icon and text change together. */}
        {Icon && (
          <Icon
            size={sizeClasses.icon}
            strokeWidth={isActive ? 2 : 1.5}
            className={cn(
              "transition-[color,stroke-width] duration-80",
              isActive ? "text-foreground" : "text-muted-foreground"
            )}
          />
        )}
        {/* Both stacked spans carry the text-box trim so the invisible bold
            sizer and the visible label keep identical boxes. */}
        <span className={cn("inline-grid whitespace-nowrap", sizeClasses.text)}>
          {/* Invisible semibold copy: reserves the bold width up front, so the
              tab doesn't widen when selected and the pills don't jump. */}
          <span
            className="col-start-1 row-start-1 invisible [text-box:trim-both_cap_alphabetic]"
            style={{ fontVariationSettings: fontWeights.semibold }}
            aria-hidden="true"
          >
            {label}
          </span>
          <span
            className={cn(
              "col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic]",
              isActive ? "text-foreground" : "text-muted-foreground"
            )}
            // Semibold only when selected, via wght + opsz so the width barely
            // moves; the sizer above absorbs what remains.
            style={{
              fontVariationSettings: isSelected
                ? fontWeights.semibold
                : fontWeights.normal,
            }}
          >
            {label}
          </span>
        </span>
      </TabsPrimitive.Trigger>
    );
  }
);

TabItem.displayName = "TabItem";

/* ─────────────────────── TabPanel ─────────────────────── */

interface TabPanelProps
  extends ComponentPropsWithoutRef<typeof TabsPrimitive.Content> {
  /** Must match a TabItem value. */
  value: string;
}

const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(
  ({ className, ...props }, ref) => {
    return (
      <TabsPrimitive.Content
        ref={ref}
        className={cn("outline-none", className)}
        {...props}
      />
    );
  }
);

TabPanel.displayName = "TabPanel";

/* ─────────────────────── Exports ─────────────────────── */

export { Tabs, TabsList, TabItem, TabPanel };
export type { TabsProps, TabsListProps, TabItemProps, TabPanelProps };
