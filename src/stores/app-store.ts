import { create } from "zustand";
import type {
  AppError,
  KiroMetadataEvent,
  ConfigOption,
  McpStatusEvent,
  ModeInfo,
  ModelInfo,
  PermissionMode,
  PermissionRequestEvent,
  ReplayMessage,
  SessionMeta,
  SessionNewResult,
  SlashCommand,
  SteeringStatus,
  SubagentView,
  SessionLoadResult,
  WorkspaceManifest,
} from "../types/acp";

export type ToolCallView = {
  toolCallId: string;
  title: string;
  kind: string;
  status: "running" | "completed" | "failed" | string;
  /** Structured payload from kiro-cli. For edit tools this carries
   *  `[{ type: "diff", path, oldText, newText }, ...]`. Other types pass
   *  through untouched so future shapes reach the UI without Rust edits. */
  content?: unknown[];
  /** File paths accessed by this tool call (from Rust file-activity events). */
  filePaths?: string[];
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  toolCalls?: ToolCallView[];
  thinking?: string;
  steering?: boolean;
};

export type AcpStatus =
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error";
export type AuthStatus = "unknown" | "checking" | "ok" | "required" | "not_installed";

export interface AppState {
  acpStatus: AcpStatus;
  authStatus: AuthStatus;

  sessionId: string | null;
  workspacePath: string | null;

  messages: Message[];
  isStreaming: boolean;

  // Phase2-c: model/mode state + context gauge
  currentModelId: string | null;
  currentModeId: string | null;
  availableModels: ModelInfo[];
  availableModes: ModeInfo[];
  contextUsagePercentage: number | null;
  cliVersion: string | null;
  agentCapabilities: unknown;
  compatibilityWarning: string | null;
  availableCommands: SlashCommand[];
  configOptions: ConfigOption[];
  currentEffort: string | null;
  subagents: SubagentView[];
  mcpStatuses: Record<string, McpStatusEvent>;
  steeringStatus: SteeringStatus;

  permissionMode: PermissionMode;
  pendingPermissions: PermissionRequestEvent[];

  // Phase2-a: persisted sessions sidebar
  persistedSessions: SessionMeta[];

  // Phase2-b: project-scope .kiro/ manifest
  workspaceManifest: WorkspaceManifest | null;

  error: AppError | null;

  // File preview panel
  previewFilePath: string | null;
  filePanelOpen: boolean;

  // Session switching transition
  isSwitchingSession: boolean;

  // actions
  setAcpStatus: (s: AcpStatus) => void;
  setAuth: (s: AuthStatus) => void;
  setSession: (sessionId: string) => void;
  setWorkspace: (path: string) => void;
  setError: (e: AppError | null) => void;

  addUserMessage: (text: string) => void;
  addSteeringMessage: (text: string) => void;
  startTurn: () => void;
  endTurn: () => void;
  appendChunk: (text: string) => void;
  appendThinking: (text: string) => void;
  addOrUpdateToolCall: (tc: ToolCallView) => void;

  // Phase2-c
  setCurrentModelId: (id: string | null) => void;
  setCurrentModeId: (id: string | null) => void;
  hydrateFromSessionResult: (r: SessionNewResult | SessionLoadResult) => void;
  applyMetadata: (e: KiroMetadataEvent) => void;
  setCliInfo: (
    version: string,
    capabilities: unknown,
    warning?: string | null,
  ) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  enqueuePermission: (request: PermissionRequestEvent) => void;
  removePermission: (requestId: string | number) => void;
  clearPermissions: () => void;
  setAvailableCommands: (commands: SlashCommand[]) => void;
  setConfigOptions: (options: ConfigOption[]) => void;
  setCurrentEffort: (effort: string | null) => void;
  setSubagents: (subagents: SubagentView[]) => void;
  updateSubagentActivity: (
    id: string,
    activity: Partial<Pick<SubagentView, "activity" | "status" | "title">>,
  ) => void;
  setMcpStatus: (event: McpStatusEvent) => void;
  setSteeringStatus: (status: SteeringStatus) => void;

  // Phase2-a
  setPersistedSessions: (list: SessionMeta[]) => void;
  removePersistedSession: (sessionId: string) => void;

  // Phase2-b
  setWorkspaceManifest: (m: WorkspaceManifest | null) => void;

  setPreviewFilePath: (path: string | null) => void;
  setFilePanelOpen: (open: boolean) => void;
  addFileActivityToToolCall: (toolCallId: string, path: string) => void;
  setIsSwitchingSession: (v: boolean) => void;

  /** Replace messages wholesale — used by session replay. Does NOT touch
   *  isStreaming or invoke any ACP calls. */
  setMessages: (msgs: Message[]) => void;

  resetSession: () => void;
}

/** Map backend ReplayMessages into the UI's Message[] shape. Assistant
 *  replay flattens text blocks into `text` and toolUse blocks into
 *  `toolCalls` with synthetic status="completed"; Tool results get
 *  stitched into the matching assistant message's toolCall text if we
 *  can find it, otherwise they become a dedicated "tool" bubble. */
export function replayToMessages(replay: ReplayMessage[]): Message[] {
  const out: Message[] = [];
  const toolByUseId = new Map<string, ToolCallView>();

  for (const r of replay) {
    if (r.role === "user") {
      out.push({ id: r.id, role: "user", text: r.text });
    } else if (r.role === "agent") {
      const text = r.blocks
        .filter((b): b is { kind: "text"; text: string } => b.kind === "text")
        .map((b) => b.text)
        .join("");
      const toolCalls: ToolCallView[] = [];
      for (const b of r.blocks) {
        if (b.kind === "toolUse") {
          const tc: ToolCallView = {
            toolCallId: b.toolUseId,
            title: b.name,
            kind: b.name,
            status: "completed",
          };
          toolCalls.push(tc);
          toolByUseId.set(b.toolUseId, tc);
        }
      }
      out.push({
        id: r.id,
        role: "assistant",
        text,
        streaming: false,
        toolCalls,
      });
    } else if (r.role === "tool") {
      // Attach the result text onto the matching tool call title for a
      // compact preview. If no match, skip — it would render as a
      // dangling "tool" bubble without context.
      const tc = toolByUseId.get(r.toolUseId);
      if (tc && r.text) {
        // Leave title alone; title is human-readable kiro name. For now
        // we just flag the call as completed (already is). No extra text
        // in Phase 2; the ToolCallCard in (d) will render richer details.
      }
    }
  }
  return out;
}

function rid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function effortFromOptions(options: ConfigOption[]): string | null {
  const effort = options.find((option) => option.id === "effort");
  return effort?.currentValue ?? effort?.value ?? null;
}

export const useApp = create<AppState>((set) => ({
  acpStatus: "disconnected",
  authStatus: "unknown",
  sessionId: null,
  workspacePath: null,
  messages: [],
  isStreaming: false,
  currentModelId: null,
  currentModeId: null,
  availableModels: [],
  availableModes: [],
  contextUsagePercentage: null,
  cliVersion: null,
  agentCapabilities: null,
  compatibilityWarning: null,
  availableCommands: [],
  configOptions: [],
  currentEffort: null,
  subagents: [],
  mcpStatuses: {},
  steeringStatus: "idle",
  permissionMode: "ask",
  pendingPermissions: [],
  persistedSessions: [],
  workspaceManifest: null,
  error: null,
  previewFilePath: null,
  filePanelOpen: false,
  isSwitchingSession: false,

  setAcpStatus: (s) => set({ acpStatus: s }),
  setAuth: (s) => set({ authStatus: s }),
  setSession: (sessionId) => set({ sessionId }),
  setWorkspace: (workspacePath) => set({ workspacePath }),
  setError: (error) => set({ error }),

  addUserMessage: (text) =>
    set((state) => ({
      messages: [...state.messages, { id: rid(), role: "user", text }],
    })),

  addSteeringMessage: (text) =>
    set((state) => ({
      messages: [
        ...state.messages.map((message) =>
          message.role === "assistant" && message.streaming
            ? { ...message, streaming: false }
            : message,
        ),
        { id: rid(), role: "user", text, steering: true },
      ],
      steeringStatus: "queued",
    })),

  startTurn: () =>
    set((state) => ({
      isStreaming: true,
      messages: [
        ...state.messages,
        { id: rid(), role: "assistant", text: "", streaming: true, toolCalls: [] },
      ],
    })),

  endTurn: () =>
    set((state) => ({
      isStreaming: false,
      messages: state.messages.map((m, i, arr) =>
        i === arr.length - 1 && m.role === "assistant"
          ? { ...m, streaming: false }
          : m,
      ),
    })),

  appendChunk: (text) =>
    set((state) => {
      const msgs = [...state.messages];
      let last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant" || !last.streaming) {
        last = { id: rid(), role: "assistant", text: "", streaming: true, toolCalls: [] };
        msgs.push(last);
      }
      msgs[msgs.length - 1] = { ...last, text: last.text + text };
      return { messages: msgs };
    }),

  appendThinking: (text) =>
    set((state) => {
      const msgs = [...state.messages];
      let last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant" || !last.streaming) {
        last = { id: rid(), role: "assistant", text: "", streaming: true, toolCalls: [] };
        msgs.push(last);
      }
      msgs[msgs.length - 1] = {
        ...last,
        thinking: (last.thinking ?? "") + text,
      };
      return { messages: msgs };
    }),

  addOrUpdateToolCall: (tc) =>
    set((state) => {
      const msgs = [...state.messages];
      let last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") {
        last = { id: rid(), role: "assistant", text: "", streaming: true, toolCalls: [] };
        msgs.push(last);
      }
      const existing = last.toolCalls ?? [];
      const idx = existing.findIndex((x) => x.toolCallId === tc.toolCallId);
      const nextList =
        idx >= 0
          ? existing.map((x, i) => (i === idx ? { ...x, ...tc } : x))
          : [...existing, tc];
      msgs[msgs.length - 1] = { ...last, toolCalls: nextList };
      return { messages: msgs };
    }),

  setCurrentModelId: (id) => set({ currentModelId: id }),
  setCurrentModeId: (id) => set({ currentModeId: id }),

  hydrateFromSessionResult: (r) =>
    set({
      currentModelId: r.models?.currentModelId ?? null,
      currentModeId: r.modes?.currentModeId ?? null,
      availableModels: r.models?.availableModels ?? [],
      availableModes: r.modes?.availableModes ?? [],
      // Fresh session/load: reset context gauge until kiro sends new metadata.
      contextUsagePercentage: null,
      configOptions: r.configOptions ?? [],
      currentEffort: effortFromOptions(r.configOptions ?? []),
      subagents: [],
      steeringStatus: "idle",
    }),

  applyMetadata: (e) => set({ contextUsagePercentage: e.contextUsagePercentage }),
  setCliInfo: (cliVersion, agentCapabilities, compatibilityWarning = null) =>
    set({ cliVersion, agentCapabilities, compatibilityWarning }),
  setPermissionMode: (permissionMode) => set({ permissionMode }),
  enqueuePermission: (request) =>
    set((state) => ({
      pendingPermissions: state.pendingPermissions.some(
        (pending) => pending.requestId === request.requestId,
      )
        ? state.pendingPermissions
        : [...state.pendingPermissions, request],
    })),
  removePermission: (requestId) =>
    set((state) => ({
      pendingPermissions: state.pendingPermissions.filter(
        (request) => request.requestId !== requestId,
      ),
    })),
  clearPermissions: () => set({ pendingPermissions: [] }),
  setAvailableCommands: (availableCommands) => set({ availableCommands }),
  setConfigOptions: (configOptions) =>
    set((state) => ({
      configOptions,
      currentEffort: effortFromOptions(configOptions) ?? state.currentEffort,
    })),
  setCurrentEffort: (currentEffort) => set({ currentEffort }),
  setSubagents: (subagents) =>
    set((state) => ({
      subagents: subagents.map((subagent) => {
        const previous = state.subagents.find((item) => item.id === subagent.id);
        return previous
          ? {
              ...previous,
              ...subagent,
              activity: subagent.activity ?? previous.activity,
            }
          : subagent;
      }),
    })),
  updateSubagentActivity: (id, activity) =>
    set((state) => ({
      subagents: state.subagents.some((subagent) => subagent.id === id)
        ? state.subagents.map((subagent) =>
            subagent.id === id ? { ...subagent, ...activity } : subagent,
          )
        : [
            ...state.subagents,
            {
              id,
              role: "subagent",
              status: activity.status ?? "working",
              ...activity,
            },
          ],
    })),
  setMcpStatus: (event) =>
    set((state) => ({
      mcpStatuses: {
        ...state.mcpStatuses,
        [event.serverName]: event,
      },
    })),
  setSteeringStatus: (steeringStatus) => set({ steeringStatus }),

  setPersistedSessions: (list) =>
    set((s) => {
      // The Rust scanner hides sessions with a live `.lock` file. Any session
      // we've already seen in this app session should stick around — once a
      // user's touched it, it shouldn't vanish just because kiro-cli grabbed
      // the lock. Merge the incoming list on top of what we already have,
      // keyed by sessionId, and sort newest first.
      const byId = new Map<string, SessionMeta>();
      for (const m of s.persistedSessions) byId.set(m.sessionId, m);
      for (const m of list) byId.set(m.sessionId, m); // fresh meta wins
      const merged = Array.from(byId.values()).sort((a, b) =>
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
      );
      return { persistedSessions: merged };
    }),

  removePersistedSession: (sessionId) =>
    set((s) => ({
      persistedSessions: s.persistedSessions.filter(
        (x) => x.sessionId !== sessionId,
      ),
    })),

  setWorkspaceManifest: (m) => set({ workspaceManifest: m }),

  setPreviewFilePath: (path) => set({ previewFilePath: path }),
  setFilePanelOpen: (open) => set({ filePanelOpen: open }),
  setIsSwitchingSession: (v) => set({ isSwitchingSession: v }),

  addFileActivityToToolCall: (toolCallId, path) =>
    set((state) => {
      const msgs = state.messages.map((m) => {
        if (m.role !== "assistant" || !m.toolCalls) return m;
        const tcs = m.toolCalls.map((tc) => {
          if (tc.toolCallId !== toolCallId) return tc;
          const existing = tc.filePaths ?? [];
          if (existing.includes(path)) return tc;
          return { ...tc, filePaths: [...existing, path] };
        });
        return { ...m, toolCalls: tcs };
      });
      return { messages: msgs };
    }),

  setMessages: (msgs) => set({ messages: msgs }),

  resetSession: () =>
    set({
      sessionId: null,
      messages: [],
      isStreaming: false,
      error: null,
      currentModelId: null,
      currentModeId: null,
      availableModels: [],
      availableModes: [],
      contextUsagePercentage: null,
      pendingPermissions: [],
      configOptions: [],
      currentEffort: null,
      subagents: [],
      mcpStatuses: {},
      steeringStatus: "idle",
      // persistedSessions stays — it's a separate concern from the active
      // session's state.
    }),
}));
