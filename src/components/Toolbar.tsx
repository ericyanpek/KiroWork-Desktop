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

export function Toolbar() {
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
    <div className="border-b border-border bg-bg-elevated/80 backdrop-blur px-4 py-2.5 flex items-center gap-3 text-xs">
      <span className="inline-flex items-center gap-1.5 text-fg-muted">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_6px_hsl(149_65%_52%/0.8)]" />
        connected
      </span>
      <span className="text-fg-subtle">·</span>
      <button
        onClick={pickFolder}
        disabled={busy}
        className="rounded-md border border-border bg-bg px-3 py-1 text-xs font-medium text-fg-muted hover:text-fg hover:border-accent/50 disabled:opacity-50 transition-colors"
      >
        {busy ? "Opening…" : "Open Folder"}
      </button>
      {workspacePath && (
        <span
          className="truncate text-fg-subtle max-w-[240px]"
          title={workspacePath}
        >
          <code className="text-[11px] text-fg-muted">{basename(workspacePath)}</code>
        </span>
      )}

      {availableModels.length > 0 && (
        <Dropdown
          label={
            <span className="flex items-center gap-1">
              <span className="text-fg-subtle">model</span>
              <span className="text-fg">{currentModel?.name ?? "…"}</span>
            </span>
          }
        >
          {(close) => (
            <>
              {availableModels.map((m) => (
                <DropdownItem
                  key={m.modelId}
                  active={m.modelId === currentModelId}
                  onClick={() => {
                    close();
                    changeModel(m.modelId);
                  }}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{m.name}</span>
                    {m.description && (
                      <span className="text-[10px] text-fg-subtle line-clamp-1">
                        {m.description}
                      </span>
                    )}
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
              <span className="text-fg-subtle">agent</span>
              <span className="text-fg">{currentMode?.name ?? "…"}</span>
            </span>
          }
        >
          {(close) => (
            <>
              {availableModes.map((m) => (
                <DropdownItem
                  key={m.id}
                  active={m.id === currentModeId}
                  onClick={() => {
                    close();
                    changeMode(m.id);
                  }}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{m.name}</span>
                    {m.description && (
                      <span className="text-[10px] text-fg-subtle line-clamp-1">
                        {m.description}
                      </span>
                    )}
                  </div>
                </DropdownItem>
              ))}
            </>
          )}
        </Dropdown>
      )}

      <div className="ml-auto flex items-center gap-3">
        <ContextGauge percentage={contextUsagePercentage} />
        {sessionId && (
          <span className="text-fg-subtle font-mono text-[11px]">
            {sessionId.slice(0, 8)}
          </span>
        )}
      </div>
    </div>
  );
}
