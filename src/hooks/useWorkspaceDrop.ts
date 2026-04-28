import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useApp } from "../stores/app-store";
import { sessionNew } from "../lib/tauri-bridge";
import type { AppError } from "../types/acp";

/**
 * Listen for folder drops on the Tauri window. The window config has
 * `dragDropEnabled: true`. If the dropped path looks like a directory,
 * start a new session against it.
 */
export function useWorkspaceDrop() {
  const setSession = useApp((s) => s.setSession);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const resetSession = useApp((s) => s.resetSession);
  const setError = useApp((s) => s.setError);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      const webview = getCurrentWebview();
      const un = await webview.onDragDropEvent(async (e) => {
        if (e.payload.type !== "drop") return;
        const first = e.payload.paths[0];
        if (!first) return;
        try {
          resetSession();
          const res = await sessionNew(first);
          setSession(res.sessionId);
          setWorkspace(first);
        } catch (err) {
          setError(err as AppError);
        }
      });
      unlisten = un;
    })();
    return () => {
      unlisten?.();
    };
  }, [resetSession, setSession, setWorkspace, setError]);
}
