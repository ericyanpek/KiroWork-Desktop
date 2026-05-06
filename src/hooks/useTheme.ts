import { useEffect, useState, useCallback } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "kirowork.theme";

function applyTheme(mode: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = mode === "dark" || (mode === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
}

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

/**
 * Three-way theme control: light / dark / system.
 * Persists to localStorage and listens to system changes when in "system" mode.
 */
export function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }, []);

  // Apply on mount + listen for system changes when mode === "system"
  useEffect(() => {
    applyTheme(mode);
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => { if (mode === "system") applyTheme("system"); };
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [mode]);

  return [mode, setMode];
}

/** Legacy hook kept for App.tsx — now delegates to useThemeMode. */
export function useSystemTheme() {
  useThemeMode();
}
