import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

/**
 * Follow the system color scheme (macOS appearance setting) and reflect it
 * by toggling the `.dark` class on <html>. Tailwind's `darkMode: "class"`
 * reads from that. Updates live when the user flips Appearance in
 * System Settings.
 */
export function useSystemTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (dark: boolean) => {
      document.documentElement.classList.toggle("dark", dark);
      setTheme(dark ? "dark" : "light");
    };
    apply(mql.matches);
    const listener = (e: MediaQueryListEvent) => apply(e.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, []);

  return theme;
}
