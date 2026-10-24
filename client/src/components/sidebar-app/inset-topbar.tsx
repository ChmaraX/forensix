"use client";

import { type ReactNode } from "react";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The main region's topbar. While the sidebar is only PEEKED the trigger
// hides (the overlay covers it anyway); after a pin it fades back in
// slightly late, so it appears at its settled position instead of riding
// the inset's slide.
// ---------------------------------------------------------------------------

export function SidebarInsetTopbar({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const { isPeeking } = useSidebar();
  return (
    <header
      className={cn("flex h-12 shrink-0 items-center gap-2 px-1.5", className)}
    >
      <SidebarTrigger
        className={`transition-opacity delay-200 duration-160 ${
          isPeeking ? "opacity-0" : "opacity-100"
        }`}
      />
      {children}
    </header>
  );
}
