import { useCallback } from "react";
import { sessionNew } from "../lib/tauri-bridge";
import { useApp } from "../stores/app-store";
import type { AppError } from "../types/acp";

/**
 * Open a workspace path: create a fresh ACP session, hydrate models/modes
 * from the response, and reset chat state. Shared by WorkspacePicker,
 * Toolbar's Open Folder button, and drag-drop.
 *
 * Throws — caller decides how to surface errors (inline vs toast).
 */
export function useOpenWorkspace() {
  const resetSession = useApp((s) => s.resetSession);
  const setSession = useApp((s) => s.setSession);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const hydrateFromSessionResult = useApp((s) => s.hydrateFromSessionResult);
  const setError = useApp((s) => s.setError);

  return useCallback(
    async (path: string) => {
      resetSession();
      try {
        const res = await sessionNew(path);
        hydrateFromSessionResult(res);
        setSession(res.sessionId);
        setWorkspace(path);
      } catch (e) {
        setError(e as AppError);
        throw e;
      }
    },
    [resetSession, setSession, setWorkspace, hydrateFromSessionResult, setError],
  );
}
