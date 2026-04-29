import { useEffect, useRef, useState } from "react";
import { checkAuth, triggerLogin } from "../lib/tauri-bridge";
import { KiroMark } from "./KiroMark";

export function LoginPage({
  message,
  onAuthenticated,
  onNotInstalled,
}: {
  message?: string;
  onAuthenticated: () => void;
  onNotInstalled: (msg: string) => void;
}) {
  const [polling, setPolling] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const pollCountRef = useRef(0);
  const POLL_MAX = 60; // 60 × 3s = 3 minutes

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  async function startLogin() {
    setPollError(null);
    try {
      await triggerLogin();
    } catch (e) {
      setPollError(String((e as { message?: string }).message ?? e));
      return;
    }
    setPolling(true);
    pollCountRef.current = 0;
    timerRef.current = window.setInterval(async () => {
      pollCountRef.current += 1;
      if (pollCountRef.current >= POLL_MAX) {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        setPolling(false);
        setPollError("Login timed out after 3 minutes. Please try again.");
        return;
      }
      try {
        const r = await checkAuth();
        if (r.status === "ok") {
          if (timerRef.current !== null) window.clearInterval(timerRef.current);
          setPolling(false);
          onAuthenticated();
        } else if (r.status === "not_installed") {
          if (timerRef.current !== null) window.clearInterval(timerRef.current);
          setPolling(false);
          onNotInstalled(r.message);
        }
      } catch (e) {
        setPollError(String((e as { message?: string }).message ?? e));
      }
    }, 3000);
  }

  return (
    <main className="flex h-full items-center justify-center px-6 kiro-ambient">
      <div className="max-w-lg rounded-2xl border border-border bg-bg-elevated/80 backdrop-blur p-8 shadow-2xl shadow-black/40 space-y-5">
        <KiroMark size="sm" />
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-accent/15 flex items-center justify-center text-accent-strong text-lg font-bold">
            →
          </div>
          <h1 className="text-xl font-semibold text-fg">Sign in to Kiro</h1>
        </div>
        <p className="text-sm text-fg-muted">
          KiroWork Desktop reuses the same credentials as the Kiro CLI. Click
          the button below and complete sign-in in the browser window that opens.
        </p>
        {message && (
          <pre className="text-xs bg-bg-muted border border-border rounded p-2 overflow-x-auto text-fg-muted">
            {message}
          </pre>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={startLogin}
            disabled={polling}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-strong hover:text-bg disabled:opacity-50 transition-colors"
          >
            {polling ? "Waiting for browser…" : "Sign in with browser"}
          </button>
          {polling && (
            <span className="text-xs text-fg-subtle">Polling every 3s…</span>
          )}
        </div>
        {pollError && <p className="text-sm text-status-error">{pollError}</p>}
        <p className="text-xs text-fg-subtle">
          Prefer the terminal? Run <code className="text-accent-strong">kiro-cli login</code> there, then press Retry.
        </p>
      </div>
    </main>
  );
}
