import { useEffect, useRef, useState } from "react";
import { checkAuth, triggerLogin } from "../lib/tauri-bridge";

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
    timerRef.current = window.setInterval(async () => {
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
    <main className="flex h-full items-center justify-center px-6">
      <div className="max-w-lg rounded-2xl border bg-white p-8 shadow-sm space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-lg font-bold">→</div>
          <h1 className="text-xl font-semibold text-gray-800">Sign in to Kiro</h1>
        </div>
        <p className="text-sm text-gray-600">
          KiroWork Desktop reuses the same credentials as the Kiro CLI. Click the button
          below and complete sign-in in the browser window that opens.
        </p>
        {message && (
          <pre className="text-xs bg-gray-50 border rounded p-2 overflow-x-auto text-gray-700">{message}</pre>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={startLogin}
            disabled={polling}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {polling ? "Waiting for browser…" : "Sign in with browser"}
          </button>
          {polling && (
            <span className="text-xs text-gray-500">Polling every 3s…</span>
          )}
        </div>
        {pollError && (
          <p className="text-sm text-red-600">{pollError}</p>
        )}
        <p className="text-xs text-gray-400">
          Prefer the terminal? Run <code>kiro-cli login</code> there, then press Retry.
        </p>
      </div>
    </main>
  );
}
