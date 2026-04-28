import { create } from "zustand";
import type {
  AppError,
  KiroMetadataEvent,
  ModeInfo,
  ModelInfo,
  SessionNewResult,
  SessionLoadResult,
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
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  toolCalls?: ToolCallView[];
};

export type AcpStatus = "disconnected" | "connecting" | "connected" | "error";
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

  error: AppError | null;

  // actions
  setAcpStatus: (s: AcpStatus) => void;
  setAuth: (s: AuthStatus) => void;
  setSession: (sessionId: string) => void;
  setWorkspace: (path: string) => void;
  setError: (e: AppError | null) => void;

  addUserMessage: (text: string) => void;
  startTurn: () => void;
  endTurn: () => void;
  appendChunk: (text: string) => void;
  addOrUpdateToolCall: (tc: ToolCallView) => void;

  // Phase2-c
  setCurrentModelId: (id: string | null) => void;
  setCurrentModeId: (id: string | null) => void;
  hydrateFromSessionResult: (r: SessionNewResult | SessionLoadResult) => void;
  applyMetadata: (e: KiroMetadataEvent) => void;

  /** Replace messages wholesale — used by session replay. Does NOT touch
   *  isStreaming or invoke any ACP calls. */
  setMessages: (msgs: Message[]) => void;

  resetSession: () => void;
}

function rid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
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
  error: null,

  setAcpStatus: (s) => set({ acpStatus: s }),
  setAuth: (s) => set({ authStatus: s }),
  setSession: (sessionId) => set({ sessionId }),
  setWorkspace: (workspacePath) => set({ workspacePath }),
  setError: (error) => set({ error }),

  addUserMessage: (text) =>
    set((state) => ({
      messages: [...state.messages, { id: rid(), role: "user", text }],
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
    }),

  applyMetadata: (e) => set({ contextUsagePercentage: e.contextUsagePercentage }),

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
    }),
}));
