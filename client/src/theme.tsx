/**
 * Theme resolution and the light/dark control.
 *
 * The stylesheet defines both modes as token blocks selected by
 * `<html data-theme>`. This module owns that attribute: it resolves the stored
 * preference (or the OS setting) before the app renders, keeps following the OS
 * while the preference is "system", and exposes a three-state control.
 */
import { Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "./lib.js";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "forensix.theme";
const PREFERENCES: readonly ThemePreference[] = ["light", "system", "dark"];

const ICONS = { light: Sun, system: Monitor, dark: Moon } as const;
const LABELS = {
  light: "Light theme",
  system: "Match system theme",
  dark: "Dark theme",
} as const;

function darkMediaQuery(): MediaQueryList {
  return globalThis.matchMedia("(prefers-color-scheme: dark)");
}

function readPreference(): ThemePreference {
  try {
    const stored = globalThis.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    /* Storage can be denied; the system default is a fine fallback. */
  }
  return "system";
}

function writePreference(preference: ThemePreference): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* A theme that does not persist still applies for this session. */
  }
}

/** Writes the resolved mode to `<html data-theme>`. */
function applyPreference(preference: ThemePreference): void {
  const resolved =
    preference === "system"
      ? darkMediaQuery().matches
        ? "dark"
        : "light"
      : preference;
  document.documentElement.dataset["theme"] = resolved;
}

/** Applies the stored theme before first paint. Call once, before render. */
export function initTheme(): void {
  applyPreference(readPreference());
}

/**
 * The active segment carries the quiet accent wash — the same treatment as
 * the active nav row — as a plain colour swap, no sliding pill, no spring.
 * On a read-only evidence surface the controls sit still; the one vivid
 * brand block on screen is the logo tile, and this control defers to it.
 */
export function ThemeToggle({ className }: { readonly className?: string }) {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    applyPreference(preference);
    if (preference !== "system") {
      return;
    }
    const media = darkMediaQuery();
    const onChange = () => {
      applyPreference("system");
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, [preference]);

  const choose = useCallback((next: ThemePreference) => {
    setPreference(next);
    writePreference(next);
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5",
        className,
      )}
    >
      {PREFERENCES.map((option) => {
        const Icon = ICONS[option];
        const active = preference === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            title={LABELS[option]}
            aria-label={LABELS[option]}
            onClick={() => {
              choose(option);
            }}
            className={cn(
              "flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors duration-150",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
