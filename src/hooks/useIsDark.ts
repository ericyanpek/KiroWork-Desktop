import { useSyncExternalStore } from "react";

/**
 * Subscribes to <html> class changes and reports whether `.dark` is set.
 * The Phase 1 `useSystemTheme` hook toggles that class from
 * prefers-color-scheme, so this hook is the read side.
 *
 * One MutationObserver for the whole app — backed by useSyncExternalStore
 * so multiple consumers don't each create their own observer.
 */

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function ensureObserver() {
  if (observer || typeof document === "undefined") return;
  observer = new MutationObserver(() => {
    for (const l of listeners) l();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

function subscribe(cb: () => void): () => void {
  ensureObserver();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
