import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useApp } from "../stores/app-store";
import { setMode, setModel } from "../lib/tauri-bridge";
import { useOpenWorkspace } from "../hooks/useOpenWorkspace";
import type { AppError } from "../types/acp";
import { Dropdown, DropdownItem } from "./Dropdown";
import { ContextGauge } from "./ContextGauge";

function basename(p: string): string {
  const trimmed = p.endsWith("/") ? p.slice(0, -1) : p;
  const i = trimmed.lastIndexOf("/");
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

export function Toolbar({
  sidebarCollapsed,
  onExpandSidebar,
}: {
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
}) {
  const sessionId = useApp((s) => s.sessionId);
  const workspacePath = useApp((s) => s.workspacePath);
  const currentModelId = useApp((s) => s.currentModelId);
  const currentModeId = useApp((s) => s.currentModeId);
  const availableModels = useApp((s) => s.availableModels);
  const availableModes = useApp((s) => s.availableModes);
  const contextUsagePercentage = useApp((s) => s.contextUsagePercentage);
  const setCurrentModelId = useApp((s) => s.setCurrentModelId);
  const setCurrentModeId = useApp((s) => s.setCurrentModeId);
  const setError = useApp((s) => s.setError);
  const openWorkspace = useOpenWorkspace();
  const [busy, setBusy] = useState(false);

  async function pickFolder() {
    setBusy(true);
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      await openWorkspace(path);
    } catch {
      /* already in store.error */
    } finally {
      setBusy(false);
    }
  }

  async function changeModel(id: string) {
    if (!sessionId || id === currentModelId) return;
    const prev = currentModelId;
    setCurrentModelId(id); // optimistic
    try {
      await setModel(sessionId, id);
    } catch (e) {
      setCurrentModelId(prev);
      setError(e as AppError);
    }
  }

  async function changeMode(id: string) {
    if (!sessionId || id === currentModeId) return;
    const prev = currentModeId;
    setCurrentModeId(id);
    try {
      await setMode(sessionId, id);
    } catch (e) {
      setCurrentModeId(prev);
      setError(e as AppError);
    }
  }

  const currentModel = availableModels.find((m) => m.modelId === currentModelId);
  const currentMode = availableModes.find((m) => m.id === currentModeId);

  return (
    <div className="relative z-10 border-b border-border/60 bg-bg-elevated/90 backdrop-blur-sm px-3 py-2 flex items-center gap-2 text-xs">

      {/* Left: sidebar toggle */}
      {sidebarCollapsed && (
        <button
          onClick={onExpandSidebar}
          title="Show sidebar"
          aria-label="Show sidebar"
          className="btn-icon w-7 h-7 text-fg-subtle hover:text-fg hover:bg-bg-muted/70 flex-shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <path d="M6 3v10" />
            <path d="M8.5 6L10.5 8L8.5 10" />
          </svg>
        </button>
      )}

      {/* Connection + workspace pill */}
      <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-muted/30 px-2.5 py-1">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-status-success shadow-[0_0_5px_hsl(var(--status-success)/0.6)] flex-shrink-0" />
        {workspacePath ? (
          <span className="text-fg-muted font-medium truncate max-w-[160px]" title={workspacePath}>
            {basename(workspacePath)}
          </span>
        ) : (
          <span className="text-fg-subtle">no folder</span>
        )}
      </div>

      {/* Open / switch folder — standalone icon button, matches sidebar toggle size */}
      <button
        onClick={pickFolder}
        disabled={busy}
        title={workspacePath ? "Switch folder" : "Open folder"}
        aria-label={workspacePath ? "Switch folder" : "Open folder"}
        className="btn-icon w-7 h-7 flex-shrink-0 text-fg-subtle hover:text-accent hover:bg-accent/10 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? (
          <svg width="14" height="14" viewBox="0 0 16 16" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="8" cy="8" r="6" strokeOpacity="0.3" />
            <path d="M8 2a6 6 0 0 1 6 6" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 4.5a1 1 0 0 1 1-1H6l1.5 1.5h6a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8z" />
          </svg>
        )}
      </button>

      {/* Model + agent dropdowns */}
      {availableModels.length > 0 && (
        <Dropdown
          label={
            <span className="flex items-center gap-1">
              <span className="text-fg-subtle/70">model</span>
              <span className="text-fg font-medium">{currentModel?.name ?? "…"}</span>
            </span>
          }
        >
          {(close) => (
            <>
              {availableModels.map((m) => (
                <DropdownItem key={m.modelId} active={m.modelId === currentModelId} onClick={() => { close(); changeModel(m.modelId); }}>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{m.name}</span>
                    {m.description && <span className="text-[10px] text-fg-subtle line-clamp-1">{m.description}</span>}
                  </div>
                </DropdownItem>
              ))}
            </>
          )}
        </Dropdown>
      )}

      {availableModes.length > 0 && (
        <Dropdown
          label={
            <span className="flex items-center gap-1">
              <span className="text-fg-subtle/70">agent</span>
              <span className="text-fg font-medium">{currentMode?.name ?? "…"}</span>
            </span>
          }
        >
          {(close) => (
            <>
              {availableModes.map((m) => (
                <DropdownItem key={m.id} active={m.id === currentModeId} onClick={() => { close(); changeMode(m.id); }}>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{m.name}</span>
                    {m.description && <span className="text-[10px] text-fg-subtle line-clamp-1">{m.description}</span>}
                  </div>
                </DropdownItem>
              ))}
            </>
          )}
        </Dropdown>
      )}

      {/* Right: context gauge + session id */}
      <div className="ml-auto flex items-center gap-2.5">
        <ContextGauge percentage={contextUsagePercentage} />
        {sessionId && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-fg-subtle/40 tabular-nums select-none"
            title={sessionId}
          >
            <span className="opacity-50">#</span>
            {sessionId.slice(0, 7)}
          </span>
        )}
      </div>
    </div>
  );
}
