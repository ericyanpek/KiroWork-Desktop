// ACP wire types accepted from supported Kiro CLI V2 releases.

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** Structured payload kiro-cli attaches to tool_call / tool_call_update
 *  notifications. For edit tools we get `{ type:"diff", path, oldText,
 *  newText }`; other shapes pass through untouched for forward-compat. */
export type ToolCallContent =
  | { type: "diff"; path: string; oldText: string; newText: string }
  | { type: string; [k: string]: unknown };

export type SessionUpdate =
  | {
      sessionUpdate: "agent_message_chunk" | "agent_thought_chunk";
      content: { type: "text" | "thinking" | "reasoning"; text: string };
    }
  | {
      sessionUpdate: "tool_call" | "tool_call_chunk";
      toolCallId: string;
      title: string;
      kind: string;
      locations?: { path: string }[];
      rawInput?: unknown;
      content?: ToolCallContent[];
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
      content?: ToolCallContent[];
    }
  // Forward-compat: future kinds pass through unhandled.
  | { sessionUpdate: string; [k: string]: unknown };

export type SessionUpdateEvent = { sessionId: string; update: SessionUpdate };

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities: unknown;
  authMethods: unknown[];
  agentInfo: { name: string; version: string; title?: string };
  cliVersion: string;
  compatibilityWarning?: string | null;
}

export type PermissionMode = "ask" | "auto";

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface PermissionRequestEvent {
  requestId: string | number;
  sessionId?: string | null;
  toolCallId?: string | null;
  title: string;
  kind: string;
  options: PermissionOption[];
}

export interface SlashCommand {
  name: string;
  description: string;
  inputHint?: string;
}

export interface ConfigOptionChoice {
  value: string;
  name?: string;
  description?: string;
}

export interface ConfigOption {
  id: string;
  name?: string;
  currentValue?: string;
  value?: string;
  options?: ConfigOptionChoice[];
}

export interface SubagentView {
  id: string;
  role: string;
  status: string;
  title?: string;
  activity?: string;
}

export type McpConnectionStatus =
  | "connecting"
  | "connected"
  | "authorization_required"
  | "error";

export interface McpStatusEvent {
  serverName: string;
  status: McpConnectionStatus;
  oauthUrl?: string | null;
  message?: string | null;
}

export type SteeringStatus = "idle" | "queued" | "consumed";

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
  configOptions?: ConfigOption[];
}

/** session/load response — mirror of SessionNewResult minus sessionId. */
export interface SessionLoadResult {
  modes: SessionNewResult["modes"];
  models: SessionNewResult["models"];
  configOptions?: ConfigOption[];
}

export interface KiroMetadataEvent {
  sessionId: string;
  contextUsagePercentage: number;
}

// Phase 2a — persisted session sidebar types (match Rust session_store.rs)
export interface SessionMeta {
  sessionId: string;
  title: string;
  cwd: string;
  updatedAt: string;
  createdAt: string;
}

export type ReplayBlock =
  | { kind: "text"; text: string }
  | { kind: "toolUse"; toolUseId: string; name: string; input: unknown };

export type ReplayMessage =
  | { role: "user"; id: string; text: string; timestamp?: number | null }
  | { role: "agent"; id: string; blocks: ReplayBlock[] }
  | { role: "tool"; id: string; toolUseId: string; text: string };

export interface LoadSessionResult {
  session: SessionLoadResult;
  replay: ReplayMessage[];
}

// Phase 2b — workspace manifest (project-scope .kiro/)
export interface SkillEntry {
  name: string;
  version?: string;
  description?: string;
  dirPath: string;
}

export interface McpServerEntry {
  name: string;
  command: string;
  args: string[];
  disabled: boolean;
}

export interface SteeringEntry {
  name: string;
  /** always | manual | auto | fileMatch (or anything else a project sets). */
  inclusion: string;
  fileMatchPattern?: string;
  filePath: string;
}

export interface WorkspaceManifest {
  skills: SkillEntry[];
  mcpServers: McpServerEntry[];
  steering: SteeringEntry[];
}

export interface PromptResult {
  stopReason: "end_turn" | string;
}

/** Emitted by the Rust layer whenever Kiro reads or writes a file. */
export interface FileActivityEvent {
  /** Absolute path of the file. */
  path: string;
  /** "read" | "write" */
  activity: "read" | "write";
  /** The ACP tool kind, e.g. "edit", "read", "grep". */
  toolKind: string;
}

export type AppError =
  | { kind: "kiro_not_found"; message: string }
  | { kind: "auth_required"; message: string }
  | { kind: "acp_connection_failed"; message: string }
  | { kind: "acp_timeout"; message: string }
  | { kind: "session_error"; message: string }
  | { kind: "workspace_error"; message: string }
  | { kind: "unknown"; message: string };
