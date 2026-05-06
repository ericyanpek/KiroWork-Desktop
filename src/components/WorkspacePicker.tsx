import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useOpenWorkspace } from "../hooks/useOpenWorkspace";
import type { AppError } from "../types/acp";
import { KiroMascot } from "./KiroMark";

export function WorkspacePicker() {
  const openWorkspace = useOpenWorkspace();
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
      await openWorkspace(path);
    } catch (e) {
      const ae = e as AppError;
      setErr(ae.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main data-tauri-drag-region className="flex h-full flex-col items-center justify-center px-6 kiro-ambient">
      <div className="flex flex-1 items-center justify-center w-full">
      <div className="w-full max-w-sm rounded-3xl border border-border/60 bg-bg-elevated/85 backdrop-blur-md p-8 shadow-2xl shadow-black/20 flex flex-col items-center gap-5 text-center">
        <KiroMascot size={96} />
        <div>
          <h1 className="text-xl font-semibold text-fg tracking-tight">Let's build</h1>
          <p className="text-sm text-fg-muted mt-1.5 leading-relaxed">
            Pick a workspace folder to get started.
          </p>
        </div>
        <button
          onClick={pick}
          disabled={busy}
          className="w-full rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground hover:bg-accent-strong disabled:opacity-50 transition-colors duration-150 shadow-md shadow-accent/20"
        >
          {busy ? "Opening…" : "Choose folder…"}
        </button>
        <p className="text-[11px] text-fg-subtle/60 select-none">
          or drag a folder onto this window
        </p>
        {err && <p className="text-sm text-status-error">{err}</p>}
      </div>
      </div>
    </main>
  );
}
