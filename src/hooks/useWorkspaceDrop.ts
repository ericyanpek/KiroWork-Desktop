import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useOpenWorkspace } from "./useOpenWorkspace";

/**
 * Listen for folder drops on the Tauri window. The window config has
 * `dragDropEnabled: true`. First dropped path that resolves as a
 * directory starts a new session.
 */
export function useWorkspaceDrop() {
  const openWorkspace = useOpenWorkspace();

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      const webview = getCurrentWebview();
      const un = await webview.onDragDropEvent(async (e) => {
        if (e.payload.type !== "drop") return;
        const first = e.payload.paths[0];
        if (!first) return;
        try {
          await openWorkspace(first);
        } catch {
          /* already captured into store.error by the hook */
        }
      });
      unlisten = un;
    })();
    return () => {
      unlisten?.();
    };
  }, [openWorkspace]);
}
