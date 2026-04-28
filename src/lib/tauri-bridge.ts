import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ContentBlock,
  InitializeResult,
  PromptResult,
  SessionNewResult,
  SessionUpdateEvent,
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
