import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useApp } from "../stores/app-store";
import { sessionNew } from "../lib/tauri-bridge";
import type { AppError } from "../types/acp";

export function Toolbar() {
  const sessionId = useApp((s) => s.sessionId);
  const workspacePath = useApp((s) => s.workspacePath);
  const setSession = useApp((s) => s.setSession);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const resetSession = useApp((s) => s.resetSession);
  const setError = useApp((s) => s.setError);
  const [busy, setBusy] = useState(false);

  async function pickFolder() {
    setBusy(true);
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      resetSession();
      const res = await sessionNew(path);
      setSession(res.sessionId);
      setWorkspace(path);
    } catch (e) {
      setError(e as AppError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b bg-white px-4 py-2 flex items-center gap-3 text-xs">
      <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
      <span className="text-gray-600">ACP: connected</span>
      <span className="text-gray-300">·</span>
      <button
        onClick={pickFolder}
        disabled={busy}
        className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:text-gray-400"
      >
        {busy ? "Opening…" : "Open Folder"}
      </button>
      {workspacePath && (
        <>
          <span className="text-gray-300">·</span>
          <span className="truncate text-gray-500">
            Workspace: <code className="text-[11px]">{workspacePath}</code>
          </span>
        </>
      )}
      {sessionId && (
        <>
          <span className="text-gray-300">·</span>
          <span className="text-gray-500">
            Session <code className="text-[11px]">{sessionId.slice(0, 8)}…</code>
          </span>
        </>
      )}
    </div>
  );
}
