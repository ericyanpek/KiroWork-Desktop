import { useCallback, useEffect, useState, type ReactNode } from "react";
import { checkAuth } from "../lib/tauri-bridge";
import { InstallGuidePage } from "./InstallGuidePage";
import { LoginPage } from "./LoginPage";
import { useApp } from "../stores/app-store";

type GateState =
  | { kind: "checking" }
  | { kind: "ok" }
  | { kind: "not_installed"; message: string }
  | { kind: "required"; message: string }
  | { kind: "error"; message: string };

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: "checking" });
  const setAcpStatus = useApp((s) => s.setAcpStatus);
  const setAuth = useApp((s) => s.setAuth);

  const runCheck = useCallback(async () => {
    setState({ kind: "checking" });
    setAuth("checking");
    try {
      const r = await checkAuth();
      if (r.status === "ok") {
        setState({ kind: "ok" });
        setAuth("ok");
        setAcpStatus("connected");
      } else if (r.status === "not_installed") {
        setState({ kind: "not_installed", message: r.message });
        setAuth("not_installed");
      } else {
        setState({ kind: "required", message: r.message });
        setAuth("required");
      }
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? String(e);
      setState({ kind: "error", message: msg });
    }
  }, [setAcpStatus, setAuth]);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  if (state.kind === "checking") {
    return (
      <main className="flex h-full items-center justify-center">
        <div className="text-sm text-gray-500">Checking Kiro CLI…</div>
      </main>
    );
  }
  if (state.kind === "not_installed") {
    return <InstallGuidePage message={state.message} onRetry={runCheck} />;
  }
  if (state.kind === "required") {
    return (
      <LoginPage
        message={state.message}
        onAuthenticated={runCheck}
        onNotInstalled={(m) => setState({ kind: "not_installed", message: m })}
      />
    );
  }
  if (state.kind === "error") {
    return (
      <main className="flex h-full items-center justify-center px-6">
        <div className="max-w-lg rounded-2xl border bg-white p-6 shadow-sm space-y-3">
          <h1 className="text-lg font-semibold text-gray-800">Startup error</h1>
          <pre className="text-xs bg-gray-50 border rounded p-2 overflow-x-auto text-gray-700">
            {state.message}
          </pre>
          <button
            onClick={runCheck}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}
