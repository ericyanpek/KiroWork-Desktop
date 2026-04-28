import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useApp } from "../stores/app-store";
import { sessionNew } from "../lib/tauri-bridge";
import type { AppError } from "../types/acp";
import { KiroMark } from "./KiroMark";

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
    <div className="border-b border-border bg-bg-elevated/80 backdrop-blur px-4 py-2.5 flex items-center gap-3 text-xs">
      <KiroMark size="sm" />
      <span className="text-fg-subtle">·</span>
      <span className="inline-flex items-center gap-1.5 text-fg-muted">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_6px_hsl(149_65%_52%/0.8)]" />
        connected
      </span>
      <span className="text-fg-subtle">·</span>
      <button
        onClick={pickFolder}
        disabled={busy}
        className="rounded-md border border-border bg-bg px-3 py-1 text-xs font-medium text-fg-muted hover:text-fg hover:border-accent/50 disabled:opacity-50 transition-colors"
      >
        {busy ? "Opening…" : "Open Folder"}
      </button>
      {workspacePath && (
        <>
          <span className="text-fg-subtle">·</span>
          <span className="truncate text-fg-subtle">
            <code className="text-[11px] text-fg-muted">{workspacePath}</code>
          </span>
        </>
      )}
      {sessionId && (
        <span className="ml-auto text-fg-subtle font-mono text-[11px]">
          {sessionId.slice(0, 8)}
        </span>
      )}
    </div>
  );
}
