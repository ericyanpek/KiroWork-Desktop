import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useApp } from "../stores/app-store";
import { sessionNew } from "../lib/tauri-bridge";
import type { AppError } from "../types/acp";
import { KiroMark, KiroMascot } from "./KiroMark";

export function WorkspacePicker() {
  const setSession = useApp((s) => s.setSession);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const setError = useApp((s) => s.setError);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick() {
    setErr(null);
    setBusy(true);
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      const res = await sessionNew(path);
      setSession(res.sessionId);
      setWorkspace(path);
    } catch (e) {
      const ae = e as AppError;
      setErr(ae.message ?? String(e));
      setError(ae);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-full items-center justify-center px-6 kiro-ambient">
      <div className="w-full max-w-md rounded-2xl border border-border bg-bg-elevated/80 backdrop-blur p-8 shadow-2xl shadow-black/40 space-y-6 text-center">
        <div className="flex justify-center">
          <KiroMascot size={128} />
        </div>
        <div className="flex justify-center">
          <KiroMark size="md" />
        </div>
        <h1 className="text-2xl font-semibold text-fg tracking-tight">
          Let's build
        </h1>
        <p className="text-sm text-fg-muted">
          Pick a workspace folder. Kiro will run in that directory with full
          access to its files.
        </p>
        <button
          onClick={pick}
          disabled={busy}
          className="w-full rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent-strong hover:text-bg disabled:opacity-50 transition-colors"
        >
          {busy ? "Opening…" : "Choose folder…"}
        </button>
        <p className="text-xs text-fg-subtle">
          …or drag a folder anywhere on this window.
        </p>
        {err && <p className="text-sm text-red-400">{err}</p>}
      </div>
    </main>
  );
}
