import { useEffect, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { useApp } from "./stores/app-store";
import { useAcp } from "./hooks/useAcp";
import { acpConnect, sessionNew } from "./lib/tauri-bridge";
import { ChatPanel } from "./components/ChatPanel";
import type { AppError } from "./types/acp";

function App() {
  useAcp();
  const sessionId = useApp((s) => s.sessionId);
  const acpStatus = useApp((s) => s.acpStatus);
  const setAcpStatus = useApp((s) => s.setAcpStatus);
  const setSession = useApp((s) => s.setSession);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const workspacePath = useApp((s) => s.workspacePath);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  // Task 3 dev bootstrap: one-click connect + create session against $HOME.
  // Task 5 replaces this with a proper folder picker.
  async function devBootstrap() {
    setBootError(null);
    setAcpStatus("connecting");
    try {
      const init = await acpConnect();
      setAgentName(init.agentInfo.name);
      setAcpStatus("connected");
      const cwd = await homeDir();
      const res = await sessionNew(cwd);
      setSession(res.sessionId);
      setWorkspace(cwd);
    } catch (e) {
      const err = e as AppError;
      setBootError(`${err.kind ?? "error"}: ${err.message ?? String(e)}`);
      setAcpStatus("error");
    }
  }

  useEffect(() => {
    // Do not auto-connect yet — Task 4 adds AuthGate for that.
  }, []);

  if (!sessionId) {
    return (
      <main className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-semibold text-gray-800">KiroWork Desktop</h1>
          <p className="text-sm text-gray-500">
            ACP status: <code>{acpStatus}</code>
          </p>
          {agentName && (
            <p className="text-sm text-gray-500">Connected to {agentName}</p>
          )}
          <button
            onClick={devBootstrap}
            disabled={acpStatus === "connecting"}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {acpStatus === "connecting" ? "Connecting…" : "Connect & Start Dev Session"}
          </button>
          {bootError && (
            <p className="max-w-md text-sm text-red-600">{bootError}</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full flex-col">
      <div className="border-b bg-white px-4 py-2 text-xs text-gray-500 flex items-center gap-3">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
        <span>ACP: connected</span>
        <span className="text-gray-300">·</span>
        <span>Session: <code className="text-[11px]">{sessionId.slice(0, 8)}…</code></span>
        {workspacePath && (
          <>
            <span className="text-gray-300">·</span>
            <span className="truncate">Workspace: <code className="text-[11px]">{workspacePath}</code></span>
          </>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <ChatPanel />
      </div>
    </main>
  );
}

export default App;
