import { useCallback, useEffect } from "react";
import {
  onWorkspaceManifestUpdated,
  scanWorkspace,
  unwatchWorkspace,
  watchWorkspace,
} from "../lib/tauri-bridge";
import { useApp } from "../stores/app-store";

/** Scan `.kiro/` on mount and whenever workspacePath changes.
 *  Also starts a Rust-side FSEvent watcher that pushes live updates via
 *  `workspace-manifest-updated` — no polling required.
 *  Returns a manual refresh callback for edge cases. */
export function useWorkspaceScan() {
  const workspacePath = useApp((s) => s.workspacePath);
  const setWorkspaceManifest = useApp((s) => s.setWorkspaceManifest);

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setWorkspaceManifest(null);
      return;
    }
    try {
      const manifest = await scanWorkspace(workspacePath);
      setWorkspaceManifest(manifest);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.debug("[workspace-scan] failed", e);
      setWorkspaceManifest(null);
    }
  }, [workspacePath, setWorkspaceManifest]);

  // Initial scan + watcher lifecycle tied to workspacePath.
  useEffect(() => {
    if (!workspacePath) {
      setWorkspaceManifest(null);
      unwatchWorkspace().catch(() => {});
      return;
    }

    refresh();
    watchWorkspace(workspacePath).catch((e) =>
      console.debug("[workspace-watcher] start failed", e),
    );

    const unlistenPromise = onWorkspaceManifestUpdated((manifest) => {
      setWorkspaceManifest(manifest);
    });

    return () => {
      unwatchWorkspace().catch(() => {});
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [workspacePath, refresh, setWorkspaceManifest]);

  return refresh;
}
