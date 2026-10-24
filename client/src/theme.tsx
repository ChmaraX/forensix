/**
 * Theme resolution and the light/dark control.
 *
 * The stylesheet defines both modes as token blocks selected by
 * `<html data-theme>`. This module owns that attribute: it resolves the stored
 * preference (or the OS setting) before the app renders, keeps following the OS
 * while the preference is "system", and exposes a three-state control.
 */
import { Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { TabItem, Tabs, TabsList } from "./components/ui/tabs.js";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "forensix.theme";
const PREFERENCES: readonly ThemePreference[] = ["light", "system", "dark"];

const ICONS = { light: Sun, system: Monitor, dark: Moon } as const;
const LABELS = { light: "Light", system: "System", dark: "Dark" } as const;
const DESCRIPTIONS = {
  light: "Light theme",
  system: "Match system theme",
  dark: "Dark theme",
} as const;

function isPreference(value: string): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

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

/** How long `html.transitioning` stays on: app.css tweens colors for 180ms. */
const CROSS_FADE_MS = 200;

/**
 * Applies a theme the user just picked with FF's cross-fade: colors tween
 * instead of snapping (a color fade, so it stays under reduced motion too).
 */
function applyWithCrossFade(preference: ThemePreference): () => void {
  const root = document.documentElement;
  root.classList.add("transitioning");
  applyPreference(preference);
  const id = setTimeout(() => {
    root.classList.remove("transitioning");
  }, CROSS_FADE_MS);
  return () => {
    clearTimeout(id);
    root.classList.remove("transitioning");
  };
}

/** Applies the stored theme before first paint. Call once, before render. */
export function initTheme(): void {
  applyPreference(readPreference());
}

/**
 * Three-way theme control on FF's segmented Tabs: the active pill slides
 * between Light / System / Dark on `spring.moderate`, labels change weight
 * without shifting, and the whole control sits on the compact ladder step.
 */
export function ThemeToggle({ className }: { readonly className?: string }) {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);
  // The first effect run only re-applies what initTheme() already painted;
  // later runs are user picks and cross-fade.
  const picked = useRef(false);

  useEffect(() => {
    const cancelFade = picked.current
      ? applyWithCrossFade(preference)
      : (applyPreference(preference), undefined);
    if (preference !== "system") {
      return cancelFade;
    }
    const media = darkMediaQuery();
    const onChange = () => {
      applyPreference("system");
    };
    media.addEventListener("change", onChange);
    return () => {
      cancelFade?.();
      media.removeEventListener("change", onChange);
    };
  }, [preference]);

  const choose = useCallback((next: string) => {
    if (!isPreference(next)) {
      return;
    }
    picked.current = true;
    setPreference(next);
    writePreference(next);
  }, []);

  return (
    <Tabs
      size="compact"
      value={preference}
      onValueChange={choose}
      className={className}
    >
      <TabsList aria-label="Theme" className="w-full">
        {PREFERENCES.map((option) => (
          <TabItem
            key={option}
            value={option}
            icon={ICONS[option]}
            label={LABELS[option]}
            title={DESCRIPTIONS[option]}
            className="flex-1 justify-center"
          />
        ))}
      </TabsList>
    </Tabs>
  );
}
