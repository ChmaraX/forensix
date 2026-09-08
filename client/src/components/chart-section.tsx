import type { ReactNode } from "react";

import { cn } from "../lib.js";

export function ChartSection({
  title,
  description,
  action,
  children,
  className,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">
            {title}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {description}
          </p>
        </div>
        {action === undefined ? null : (
          <div className="ml-auto shrink-0">{action}</div>
        )}
      </header>
      {children}
    </section>
  );
}
