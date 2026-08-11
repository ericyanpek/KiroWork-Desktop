import { useCallback, useEffect, useState, type ReactNode } from "react";
import { checkAuth } from "../lib/tauri-bridge";
import { InstallGuidePage } from "./InstallGuidePage";
import { LoginPage } from "./LoginPage";
import { useApp } from "../stores/app-store";
import { KiroMascot } from "./KiroMark";

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
  const setCliInfo = useApp((s) => s.setCliInfo);

  const runCheck = useCallback(async () => {
    setState({ kind: "checking" });
    setAuth("checking");
    try {
      const r = await checkAuth();
      if (r.status === "ok") {
        setCliInfo(
          r.cliVersion,
          r.agentCapabilities,
          r.compatibilityWarning,
        );
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
  }, [setAcpStatus, setAuth, setCliInfo]);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  if (state.kind === "checking") {
    return (
      <main className="flex h-full items-center justify-center kiro-ambient">
        <div className="flex flex-col items-center gap-4 animate-pulse">
          <KiroMascot size={96} />
          <div className="text-sm text-fg-muted">Starting Kiro…</div>
        </div>
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
      <main className="flex h-full items-center justify-center px-6 kiro-ambient">
        <div className="max-w-lg rounded-2xl border border-border bg-bg-elevated/80 backdrop-blur p-6 shadow-2xl shadow-black/40 space-y-3">
          <h1 className="text-lg font-semibold text-fg">Startup error</h1>
          <pre className="text-xs bg-bg-muted border border-border rounded p-2 overflow-x-auto text-fg-muted">
            {state.message}
          </pre>
          <button
            onClick={runCheck}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-strong hover:text-bg transition-colors"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}
