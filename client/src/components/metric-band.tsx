import type { ReactNode } from "react";

import { cn } from "../lib.js";

export type MetricBandTone =
  | "neutral"
  | "success"
  | "warning"
  | "destructive"
  | "violet";

export interface MetricBandProgress {
  readonly value: number;
  readonly max: number;
  readonly tone?: MetricBandTone;
  readonly label?: ReactNode;
}

export function MetricBand({
  children,
  className,
  variant = "default",
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly variant?: "default" | "accent";
}) {
  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-lg border border-border bg-card",
        variant === "accent"
          ? "metric-band-accent fx-hero border-white/10 text-white"
          : undefined,
        className,
      )}
    >
      {children}
    </div>
  );
}

const PROGRESS_TONE: Record<MetricBandTone, string> = {
  neutral: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  violet: "bg-violet",
};

export function MetricBandItem({
  label,
  value,
  detail,
  icon,
  status,
  progress,
  tone = "neutral",
  valueClassName,
}: {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
  readonly icon?: ReactNode;
  readonly status?: ReactNode;
  readonly progress?: MetricBandProgress;
  readonly tone?: MetricBandTone;
  readonly valueClassName?: string;
}) {
  const progressPercent =
    progress === undefined || progress.max <= 0
      ? 0
      : Math.min(100, Math.max(0, (progress.value / progress.max) * 100));

  return (
    <div className="metric-band-item flex min-h-[104px] min-w-0 flex-col px-4 py-4 sm:min-h-[112px] sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <span className="metric-band-label flex min-w-0 items-center gap-1.5 truncate text-[10px] font-semibold tracking-[0.11em] text-muted-foreground uppercase">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        {status === undefined ? null : (
          <span className="metric-band-status shrink-0 text-[11px] text-muted-foreground">
            {status}
          </span>
        )}
      </div>
      <span
        className={cn(
          "metric-band-value mt-3 block truncate text-[32px] leading-none font-semibold tracking-[-0.045em] tabular-nums",
          valueClassName,
        )}
      >
        {value}
      </span>
      {progress === undefined ? null : (
        <div className="mt-3 flex flex-col gap-1.5">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.max}
            aria-valuenow={Math.min(progress.max, Math.max(0, progress.value))}
          >
            <span
              className={cn(
                "block h-full rounded-full transition-[width] duration-500",
                PROGRESS_TONE[progress.tone ?? tone],
              )}
              style={{ width: `${String(progressPercent)}%` }}
            />
          </div>
          {progress.label === undefined ? null : (
            <span className="metric-band-progress-label truncate text-[11px] text-muted-foreground">
              {progress.label}
            </span>
          )}
        </div>
      )}
      {detail === undefined ? null : (
        <span
          className="metric-band-detail mt-2 truncate text-[12px] text-muted-foreground"
          title={typeof detail === "string" ? detail : undefined}
        >
          {detail}
        </span>
      )}
    </div>
  );
}
