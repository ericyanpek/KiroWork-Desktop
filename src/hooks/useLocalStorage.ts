import { useCallback, useEffect, useState } from "react";

/**
 * Boolean state persisted to localStorage. Reads synchronously on mount so
 * the first paint already reflects the stored value — no "Show" flash when
 * the user has previously picked "Hide".
 *
 * SSR-safe: localStorage access is gated on `typeof window`.
 */
export function useLocalStorageBoolean(
  key: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void, () => void] {
  const read = (): boolean => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return raw === "true";
    } catch {
      return defaultValue;
    }
  };

  const [value, setValueState] = useState<boolean>(read);

  const setValue = useCallback(
    (next: boolean) => {
      setValueState(next);
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        /* ignore quota / access errors */
      }
    },
    [key],
  );

  const toggle = useCallback(() => setValue(!value), [value, setValue]);

  // Sync across windows/tabs if the key changes elsewhere.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        setValueState(e.newValue === "true");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  return [value, setValue, toggle];
}
