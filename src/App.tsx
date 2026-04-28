import { useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { useApp } from "./stores/app-store";
import { useAcp } from "./hooks/useAcp";
import { sessionNew } from "./lib/tauri-bridge";
import { ChatPanel } from "./components/ChatPanel";
import { AuthGate } from "./components/AuthGate";
import type { AppError } from "./types/acp";

function MainUI() {
  useAcp();
  const sessionId = useApp((s) => s.sessionId);
  const workspacePath = useApp((s) => s.workspacePath);
  const setSession = useApp((s) => s.setSession);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const [bootError, setBootError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Task 3 dev bootstrap: uses $HOME as cwd. Task 5 swaps this for a real
  // folder picker. ACP is already connected by AuthGate at this point.
  async function devBootstrap() {
    setBootError(null);
    setStarting(true);
    try {
      const cwd = await homeDir();
      const res = await sessionNew(cwd);
      setSession(res.sessionId);
      setWorkspace(cwd);
    } catch (e) {
      const err = e as AppError;
      setBootError(`${err.kind ?? "error"}: ${err.message ?? String(e)}`);
    } finally {
      setStarting(false);
    }
  }

  if (!sessionId) {
    return (
      <main className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-semibold text-gray-800">KiroWork Desktop</h1>
          <p className="text-sm text-gray-500">Connected to Kiro. Pick a workspace to start.</p>
          <button
            onClick={devBootstrap}
            disabled={starting}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {starting ? "Starting…" : "Start dev session (home folder)"}
          </button>
          {bootError && <p className="max-w-md text-sm text-red-600">{bootError}</p>}
          <p className="text-xs text-gray-400">
            Task 5 will replace this with a real folder picker.
          </p>
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

export default function App() {
  return (
    <AuthGate>
      <MainUI />
    </AuthGate>
  );
}
