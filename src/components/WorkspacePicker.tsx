import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useApp } from "../stores/app-store";
import { sessionNew } from "../lib/tauri-bridge";
import type { AppError } from "../types/acp";

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
    <main className="flex h-full items-center justify-center px-6">
      <div className="max-w-md w-full rounded-2xl border bg-white p-8 shadow-sm space-y-5 text-center">
        <h1 className="text-2xl font-semibold text-gray-800">Open a workspace</h1>
        <p className="text-sm text-gray-600">
          Pick the folder you want to work in. Kiro will run with that folder
          as its working directory.
        </p>
        <button
          onClick={pick}
          disabled={busy}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          {busy ? "Opening…" : "Choose folder…"}
        </button>
        <p className="text-xs text-gray-400">
          Or drag a folder anywhere on this window.
        </p>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </main>
  );
}
