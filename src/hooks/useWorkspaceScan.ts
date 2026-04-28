import { useCallback, useEffect } from "react";
import { scanWorkspace } from "../lib/tauri-bridge";
import { useApp } from "../stores/app-store";

/** Scan the current workspacePath's .kiro/ dir whenever it changes, and
 *  expose a manual refresh callback. Silently clears the manifest when
 *  no workspace is active. */
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

  useEffect(() => {
    refresh();
  }, [refresh]);

  return refresh;
}
