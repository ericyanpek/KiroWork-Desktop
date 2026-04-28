import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ContentBlock,
  InitializeResult,
  KiroMetadataEvent,
  LoadSessionResult,
  PromptResult,
  SessionMeta,
  SessionNewResult,
  SessionUpdateEvent,
  WorkspaceManifest,
} from "../types/acp";

// Single place where invoke/listen happen. Components must import from here.

export function acpConnect(): Promise<InitializeResult> {
  return invoke<InitializeResult>("acp_connect");
}

export function acpDisconnect(): Promise<void> {
  return invoke<void>("acp_disconnect");
}

export function acpStatus(): Promise<"connected" | "disconnected"> {
  return invoke<"connected" | "disconnected">("acp_status");
}

export function sessionNew(cwd: string): Promise<SessionNewResult> {
  return invoke<SessionNewResult>("session_new", { cwd });
}

export function sessionPrompt(
  sessionId: string,
  prompt: ContentBlock[],
): Promise<PromptResult> {
  return invoke<PromptResult>("session_prompt", { sessionId, prompt });
}

export function sessionCancel(sessionId: string): Promise<void> {
  return invoke<void>("session_cancel", { sessionId });
}

export function setModel(sessionId: string, modelId: string): Promise<unknown> {
  return invoke<unknown>("set_model", { sessionId, modelId });
}

export function setMode(sessionId: string, modeId: string): Promise<unknown> {
  return invoke<unknown>("set_mode", { sessionId, modeId });
}

export function listPersistedSessions(): Promise<SessionMeta[]> {
  return invoke<SessionMeta[]>("list_persisted_sessions");
}

export function loadSession(
  sessionId: string,
  cwd: string,
): Promise<LoadSessionResult> {
  return invoke<LoadSessionResult>("load_session", { sessionId, cwd });
}

export function scanWorkspace(path: string): Promise<WorkspaceManifest> {
  return invoke<WorkspaceManifest>("scan_workspace", { path });
}

/** Read an arbitrary file as bytes. Returns a raw Uint8Array (Tauri
 *  serialises Vec<u8> as number[] over IPC; we coerce here). */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const arr = await invoke<number[]>("read_file_bytes", { path });
  return new Uint8Array(arr);
}

export function onSessionUpdate(
  cb: (ev: SessionUpdateEvent) => void,
): Promise<UnlistenFn> {
  return listen<SessionUpdateEvent>("session-update", (e) => cb(e.payload));
}

export function onAcpStatus(
  cb: (status: "connected" | "disconnected") => void,
): Promise<UnlistenFn> {
  return listen<"connected" | "disconnected">("acp-status-changed", (e) =>
    cb(e.payload),
  );
}

export type AuthStatusPayload =
  | { status: "ok"; user?: string | null }
  | { status: "not_installed"; message: string }
  | { status: "required"; message: string };

export function checkAuth(): Promise<AuthStatusPayload> {
  return invoke<AuthStatusPayload>("check_auth");
}

export function triggerLogin(): Promise<void> {
  return invoke<void>("trigger_login");
}

export function onKiroMetadata(
  cb: (ev: KiroMetadataEvent) => void,
): Promise<UnlistenFn> {
  return listen<KiroMetadataEvent>("kiro-metadata", (e) => cb(e.payload));
}

export function onKiroCommands(
  cb: (payload: unknown) => void,
): Promise<UnlistenFn> {
  return listen<unknown>("kiro-commands", (e) => cb(e.payload));
}

export function onKiroSubagents(
  cb: (payload: unknown) => void,
): Promise<UnlistenFn> {
  return listen<unknown>("kiro-subagents", (e) => cb(e.payload));
}
