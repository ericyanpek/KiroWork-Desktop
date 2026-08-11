import { useState, useRef, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { useApp } from "../stores/app-store";
import {
  executeCommand,
  exportTranscript,
  setMode,
  setModel,
  setPermissionMode as setBackendPermissionMode,
} from "../lib/tauri-bridge";
import { useOpenWorkspace } from "../hooks/useOpenWorkspace";
import { useThemeMode, type ThemeMode } from "../hooks/useTheme";
import type { AppError } from "../types/acp";
import type { PermissionMode } from "../types/acp";
import type { Message } from "../stores/app-store";
import { Dropdown, DropdownItem } from "./Dropdown";
import { ContextGauge } from "./ContextGauge";

function FilePanelToggle() {
  const filePanelOpen = useApp((s) => s.filePanelOpen);
  const setFilePanelOpen = useApp((s) => s.setFilePanelOpen);

  return (
    <button
      onClick={() => setFilePanelOpen(!filePanelOpen)}
      title={filePanelOpen ? "Hide file panel" : "Show file panel"}
      aria-label={filePanelOpen ? "Hide file panel" : "Show file panel"}
      className={`flex items-center justify-center w-7 h-6 rounded-full border transition-colors duration-150 ${
        filePanelOpen
          ? "border-accent/60 bg-accent/10 text-accent hover:bg-accent/20"
          : "border-border/60 bg-bg/60 text-fg-subtle hover:text-fg hover:border-accent/40 hover:bg-bg-muted/60"
      }`}
    >
      {/* panel-right icon */}
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
        <path d="M10 3v10" />
      </svg>
    </button>
  );
}

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀" },
  { value: "system", label: "Auto", icon: "⬡" },
  { value: "dark", label: "Dark", icon: "☾" },
];

function ThemeSwitcher() {
  const [themeMode, setThemeMode] = useThemeMode();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeOpt = THEME_OPTIONS.find((o) => o.value === themeMode) ?? THEME_OPTIONS[1];
  const activeIdx = THEME_OPTIONS.findIndex((o) => o.value === themeMode);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {/* Trigger — shows current state only */}
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Theme: ${activeOpt.label}`}
        aria-label="Toggle theme"
        className="flex items-center justify-center w-7 h-6 rounded-full border border-border/60 bg-bg/60 text-[12px] text-fg-subtle hover:text-fg hover:border-accent/40 hover:bg-bg-muted/60 transition-colors duration-150"
      >
        {activeOpt.icon}
      </button>

      {/* Floating slider pill */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 flex items-center rounded-full border border-border/70 bg-bg-elevated shadow-lg shadow-black/10 p-0.5 gap-0">
          <span
            className="absolute top-0.5 bottom-0.5 rounded-full bg-bg-muted shadow-sm transition-all duration-200 ease-out"
            style={{
              left: `calc(${activeIdx} * 33.333% + 2px)`,
              width: "calc(33.333% - 4px)",
            }}
          />
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setThemeMode(opt.value); setOpen(false); }}
              title={opt.label}
              aria-label={opt.label}
              className={`relative z-10 flex items-center justify-center w-8 h-6 text-[12px] rounded-full transition-colors duration-150 ${
                themeMode === opt.value ? "text-fg" : "text-fg-subtle/50 hover:text-fg-subtle"
              }`}
            >
              {opt.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function basename(p: string): string {
  const trimmed = p.endsWith("/") ? p.slice(0, -1) : p;
  const i = trimmed.lastIndexOf("/");
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

function transcriptMarkdown(
  messages: Message[],
  workspacePath: string | null,
): string {
  const lines = [
    "# KiroWork Transcript",
    "",
    `Exported: ${new Date().toISOString()}`,
    ...(workspacePath ? [`Workspace: \`${workspacePath}\``] : []),
    "",
  ];

  for (const message of messages) {
    lines.push(`## ${message.role === "user" ? "User" : "Assistant"}`, "");
    if (message.steering) lines.push("_Steering message_", "");
    if (message.thinking) {
      lines.push(
        "<details>",
        "<summary>Reasoning</summary>",
        "",
        message.thinking,
        "",
        "</details>",
        "",
      );
    }
    if (message.text) lines.push(message.text, "");
    if (message.toolCalls?.length) {
      lines.push("### Tool calls", "");
      for (const call of message.toolCalls) {
        lines.push(`- **${call.title || call.kind}** (${call.status})`);
        for (const path of call.filePaths ?? []) {
          lines.push(`  - \`${path}\``);
        }
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function Toolbar({
  sidebarCollapsed,
}: {
  sidebarCollapsed: boolean;
  onExpandSidebar?: () => void;
}) {
  const sessionId = useApp((s) => s.sessionId);
  const workspacePath = useApp((s) => s.workspacePath);
  const currentModelId = useApp((s) => s.currentModelId);
  const currentModeId = useApp((s) => s.currentModeId);
  const availableModels = useApp((s) => s.availableModels);
  const availableModes = useApp((s) => s.availableModes);
  const contextUsagePercentage = useApp((s) => s.contextUsagePercentage);
  const cliVersion = useApp((s) => s.cliVersion);
  const permissionMode = useApp((s) => s.permissionMode);
  const messages = useApp((s) => s.messages);
  const configOptions = useApp((s) => s.configOptions);
  const currentEffort = useApp((s) => s.currentEffort);
  const setCurrentModelId = useApp((s) => s.setCurrentModelId);
  const setCurrentModeId = useApp((s) => s.setCurrentModeId);
  const setCurrentEffort = useApp((s) => s.setCurrentEffort);
  const setError = useApp((s) => s.setError);
  const setPermissionMode = useApp((s) => s.setPermissionMode);
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

  async function changePermissionMode(mode: PermissionMode) {
    if (mode === permissionMode) return;
    const previous = permissionMode;
    setPermissionMode(mode);
    try {
      await setBackendPermissionMode(mode === "auto");
    } catch (e) {
      setPermissionMode(previous);
      setError(e as AppError);
    }
  }

  async function changeEffort(level: string) {
    if (!sessionId || level === currentEffort) return;
    const previous = currentEffort;
    setCurrentEffort(level);
    try {
      await executeCommand(sessionId, "effort", { level });
    } catch (e) {
      setCurrentEffort(previous);
      setError(e as AppError);
    }
  }

  async function saveTranscript() {
    if (messages.length === 0) return;
    try {
      const defaultName = `${basename(workspacePath ?? "kirowork")}-transcript.md`;
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      await exportTranscript(path, transcriptMarkdown(messages, workspacePath));
    } catch (e) {
      setError(e as AppError);
    }
  }

  const currentModel = availableModels.find((m) => m.modelId === currentModelId);
  const currentMode = availableModes.find((m) => m.id === currentModeId);
  const effortOption = configOptions.find((option) => option.id === "effort");
  const effortLevels = effortOption?.options ?? [];

  return (
    <div className={`relative z-10 mr-2 mt-[6px] rounded-xl bg-bg-muted/10 backdrop-blur-xl px-3 py-1 flex items-center gap-2 text-xs shadow-[0_2px_16px_-4px_hsl(var(--accent)/0.15),0_0_0_1px_hsl(var(--border)/0.5)] pointer-events-auto min-w-0 ${sidebarCollapsed ? "ml-[120px]" : "ml-2"}`}>


      {/* Unified workspace pill — click anywhere to open/switch folder */}
      <button
        onClick={pickFolder}
        disabled={busy}
        title={workspacePath ? `Switch folder (${workspacePath})` : "Open folder"}
        aria-label={workspacePath ? "Switch folder" : "Open folder"}
        className="group flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-muted/30 px-2.5 py-1 hover:border-accent/40 hover:bg-bg-muted/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 flex-shrink-0"
      >
        {/* Connection dot */}
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-status-success shadow-[0_0_5px_hsl(var(--status-success)/0.6)] flex-shrink-0"
          title={cliVersion ?? "Kiro CLI connected"}
        />

        {/* Directory name — truncates gracefully */}
        {workspacePath ? (
          <span className="text-fg-muted font-medium truncate max-w-[90px] xl:max-w-[140px] group-hover:text-fg transition-colors duration-150">
            {basename(workspacePath)}
          </span>
        ) : (
          <span className="text-fg-subtle group-hover:text-fg-muted transition-colors duration-150">
            Open folder…
          </span>
        )}

        {/* Trailing icon — spinner when busy, folder when idle */}
        <span className="flex-shrink-0 text-fg-subtle/40 group-hover:text-accent/70 transition-colors duration-150">
          {busy ? (
            <svg width="11" height="11" viewBox="0 0 16 16" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="8" cy="8" r="6" strokeOpacity="0.3" />
              <path d="M8 2a6 6 0 0 1 6 6" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 4.5a1 1 0 0 1 1-1H6l1.5 1.5h6a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8z" />
            </svg>
          )}
        </span>
      </button>

      {/* Model + agent dropdowns */}
      {availableModels.length > 0 && (
        <Dropdown
          className="flex-shrink-0"
          label={
            <span className="flex items-center gap-1">
              <span className="hidden text-fg-subtle/70 xl:inline">model</span>
              <span className="max-w-[90px] truncate text-fg font-medium xl:max-w-[150px]">
                {currentModel?.name ?? "…"}
              </span>
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
          className="flex-shrink-0"
          label={
            <span className="flex items-center gap-1">
              <span className="hidden text-fg-subtle/70 xl:inline">agent</span>
              <span className="max-w-[80px] truncate text-fg font-medium xl:max-w-[130px]">
                {currentMode?.name ?? "…"}
              </span>
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

      {effortLevels.length > 0 && (
        <Dropdown
          className="flex-shrink-0"
          label={
            <span className="flex items-center gap-1">
              <span className="hidden text-fg-subtle/70 xl:inline">effort</span>
              <span className="text-fg font-medium">
                {effortLevels.find((level) => level.value === currentEffort)?.name ??
                  currentEffort ??
                  "Default"}
              </span>
            </span>
          }
        >
          {(close) => (
            <>
              {effortLevels.map((level) => (
                <DropdownItem
                  key={level.value}
                  active={level.value === currentEffort}
                  onClick={() => {
                    close();
                    changeEffort(level.value);
                  }}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{level.name ?? level.value}</span>
                    {level.description && (
                      <span className="text-[10px] text-fg-subtle">
                        {level.description}
                      </span>
                    )}
                  </div>
                </DropdownItem>
              ))}
            </>
          )}
        </Dropdown>
      )}

      <Dropdown
        className="flex-shrink-0"
        label={
          <span className="flex items-center gap-1">
            <span className="hidden text-fg-subtle/70 xl:inline">tools</span>
            <span className="text-fg font-medium">
              {permissionMode === "auto" ? "Auto" : "Ask"}
            </span>
          </span>
        }
      >
        {(close) => (
          <>
            <DropdownItem
              active={permissionMode === "ask"}
              onClick={() => {
                close();
                changePermissionMode("ask");
              }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">Ask</span>
                <span className="text-[10px] text-fg-subtle">
                  Review each tool request
                </span>
              </div>
            </DropdownItem>
            <DropdownItem
              active={permissionMode === "auto"}
              onClick={() => {
                close();
                changePermissionMode("auto");
              }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">Auto</span>
                <span className="text-[10px] text-fg-subtle">
                  Approve tool requests this run
                </span>
              </div>
            </DropdownItem>
          </>
        )}
      </Dropdown>

      {/* Drag region spacer — fills the gap between left and right controls */}
      <div
        data-tauri-drag-region
        className="flex-1 self-stretch"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          console.log("drag mousedown fired");
          getCurrentWindow().startDragging();
        }}
      />

      {/* Right controls — left-to-right: context gauge, theme, panel toggle (panel rightmost, nearest to the panel) */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        <ContextGauge percentage={contextUsagePercentage} />
        <button
          onClick={saveTranscript}
          disabled={messages.length === 0}
          title="Export transcript"
          aria-label="Export transcript"
          className="flex items-center justify-center w-7 h-6 rounded-full border border-border/60 bg-bg/60 text-fg-subtle hover:text-fg hover:border-accent/40 hover:bg-bg-muted/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2v8M5 7l3 3 3-3" />
            <path d="M3 11v2h10v-2" />
          </svg>
        </button>
        <ThemeSwitcher />
        <FilePanelToggle />
      </div>
    </div>
  );
}
