// TypeScript types for the real ACP protocol as emitted by kiro-cli 2.1.1.
// Probed live, not taken from DESIGN.md (which has several incorrect shapes).

export type ContentBlock = { type: "text"; text: string };

export type SessionUpdate =
  | { sessionUpdate: "agent_message_chunk"; content: { type: "text"; text: string } }
  | {
      sessionUpdate: "tool_call";
      toolCallId: string;
      title: string;
      kind: string;
      locations?: { path: string }[];
      rawInput?: unknown;
    }
  | {
      sessionUpdate: "tool_call_update";
      toolCallId: string;
      kind: string;
      status: string;
      title?: string;
      locations?: { path: string }[];
      rawInput?: unknown;
      rawOutput?: unknown;
    }
  // Forward-compat: future kinds pass through unhandled.
  | { sessionUpdate: string; [k: string]: unknown };

export type SessionUpdateEvent = { sessionId: string; update: SessionUpdate };

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities: unknown;
  authMethods: unknown[];
  agentInfo: { name: string; version: string; title?: string };
}

export interface ModeInfo {
  id: string;
  name: string;
  description?: string;
}

export interface ModelInfo {
  modelId: string;
  name: string;
  description?: string;
}

export interface SessionNewResult {
  sessionId: string;
  modes: {
    currentModeId: string;
    availableModes: ModeInfo[];
  };
  models: {
    currentModelId: string;
    availableModels: ModelInfo[];
  };
}

/** session/load response — mirror of SessionNewResult minus sessionId. */
export interface SessionLoadResult {
  modes: SessionNewResult["modes"];
  models: SessionNewResult["models"];
}

export interface KiroMetadataEvent {
  sessionId: string;
  contextUsagePercentage: number;
}

export interface PromptResult {
  stopReason: "end_turn" | string;
}

export type AppError =
  | { kind: "kiro_not_found"; message: string }
  | { kind: "auth_required"; message: string }
  | { kind: "acp_connection_failed"; message: string }
  | { kind: "acp_timeout"; message: string }
  | { kind: "session_error"; message: string }
  | { kind: "workspace_error"; message: string }
  | { kind: "unknown"; message: string };
