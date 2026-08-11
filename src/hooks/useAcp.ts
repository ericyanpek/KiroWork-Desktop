import { useEffect, useRef } from "react";
import {
  onAcpStatus,
  onFileActivity,
  onKiroMetadata,
  onKiroCommands,
  onKiroSubagentActivity,
  onKiroSubagents,
  onMcpStatus,
  onPermissionRequest,
  onSessionUpdate,
  reconnectAcp,
} from "../lib/tauri-bridge";
import {
  normalizeCommands,
  normalizeSubagents,
} from "../lib/acp-normalizers";
import {
  retryWithDelays,
  shouldAutoReconnect,
} from "../lib/reconnect";
import { useApp } from "../stores/app-store";
import type { AppError, ConfigOption, SubagentView } from "../types/acp";

/**
 * Wires Tauri events into the zustand store. Mount once, high in the tree.
 *
 * `session/update` is the ONLY streaming notification — the design doc's
 * separate `AgentMessageChunk` / `ToolCall` / `TurnEnd` methods do not exist.
 * End-of-turn is signalled by the `session/prompt` response resolving, not
 * by any notification.
 *
 * Subscription safety:
 *   React 18/19 StrictMode double-mounts effects in dev. Since `listen()` is
 *   async (returns a Promise<Unlisten>), the naive pattern of `.then(u => unsub = u)`
 *   leaks the first listener on teardown because its unlisten hasn't resolved
 *   yet. We guard with a module-level latch + an awaited unlisten: both the
 *   first and second mount see the SAME promise, and the teardown awaits it
 *   before calling unsubscribe. Net effect: exactly one active listener at all
 *   times.
 *
 *   We also read sessionId via a ref so incoming updates for the current
 *   session aren't filtered out due to a stale closure, without making
 *   sessionId part of the effect deps (which would re-subscribe on every
 *   session change and risk duplicate deliveries).
 */

// Store the latch on globalThis so Vite HMR module reloads don't reset it
// and spin up duplicate listeners.
const g = globalThis as Record<string, unknown>;
if (!g.__kiroAcpUnsub) {
  g.__kiroAcpUnsub = {
    subscribed: false,
    update: null,
    status: null,
    metadata: null,
    fileActivity: null,
    permission: null,
    commands: null,
    subagents: null,
    subagentActivity: null,
    mcpStatus: null,
  };
}
const rawListenerState = g.__kiroAcpUnsub as Record<string, unknown>;
for (const key of ["commands", "subagents", "subagentActivity", "mcpStatus"]) {
  if (!(key in rawListenerState)) rawListenerState[key] = null;
}
const _state = g.__kiroAcpUnsub as {
  subscribed: boolean;
  update: Promise<() => void> | null;
  status: Promise<() => void> | null;
  metadata: Promise<() => void> | null;
  fileActivity: Promise<() => void> | null;
  permission: Promise<() => void> | null;
  commands: Promise<() => void> | null;
  subagents: Promise<() => void> | null;
  subagentActivity: Promise<() => void> | null;
  mcpStatus: Promise<() => void> | null;
};

// Module-level chunk buffer — survives React re-renders and the _state latch.
// Flush with setTimeout(0) instead of rAF: rAF is throttled when the WKWebView
// window is not in the foreground or has no pending paint, which would silently
// drop chunks.
let _pendingChunk = "";
let _pendingThinking = "";
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _flushFn: ((text: string) => void) | null = null;
let _thinkingFlushFn: ((text: string) => void) | null = null;

function _scheduleFlush() {
  if (_flushTimer !== null) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    if (_pendingChunk && _flushFn) {
      _flushFn(_pendingChunk);
      _pendingChunk = "";
    }
    if (_pendingThinking && _thinkingFlushFn) {
      _thinkingFlushFn(_pendingThinking);
      _pendingThinking = "";
    }
  }, 0);
}

export function useAcp() {
  const appendChunk = useApp((s) => s.appendChunk);
  const appendThinking = useApp((s) => s.appendThinking);
  const addOrUpdateToolCall = useApp((s) => s.addOrUpdateToolCall);
  const setAcpStatus = useApp((s) => s.setAcpStatus);
  const applyMetadata = useApp((s) => s.applyMetadata);
  const setPreviewFilePath = useApp((s) => s.setPreviewFilePath);
  const addFileActivityToToolCall = useApp((s) => s.addFileActivityToToolCall);
  const enqueuePermission = useApp((s) => s.enqueuePermission);
  const clearPermissions = useApp((s) => s.clearPermissions);
  const setAvailableCommands = useApp((s) => s.setAvailableCommands);
  const setConfigOptions = useApp((s) => s.setConfigOptions);
  const setSubagents = useApp((s) => s.setSubagents);
  const updateSubagentActivity = useApp((s) => s.updateSubagentActivity);
  const setMcpStatus = useApp((s) => s.setMcpStatus);
  const setSteeringStatus = useApp((s) => s.setSteeringStatus);

  // Keep module-level flush fn pointing at latest appendChunk.
  useEffect(() => { _flushFn = appendChunk; }, [appendChunk]);
  useEffect(() => { _thinkingFlushFn = appendThinking; }, [appendThinking]);

  // Latest-value ref so updates for the active session aren't dropped without
  // putting sessionId in effect deps (which would re-subscribe on every change).
  const currentSessionIdRef = useRef<string | null>(null);
  const sessionId = useApp((s) => s.sessionId);
  useEffect(() => {
    currentSessionIdRef.current = sessionId;
  }, [sessionId]);

  // Track the most recent tool call ID so file-activity events can be attached.
  const lastToolCallIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (_state.subscribed) return;
    _state.subscribed = true;

    _state.update = onSessionUpdate(({ sessionId: incoming, update }) => {
      const active = currentSessionIdRef.current;
      if (active && incoming !== active) return;

      switch (update.sessionUpdate) {
        case "agent_message_chunk":
        case "agent_thought_chunk": {
          const content = (update as {
            content?: { type?: string; text?: string };
          }).content;
          const text = content?.text ?? "";
          if (text) {
            const thinking =
              update.sessionUpdate === "agent_thought_chunk" ||
              content?.type === "thinking" ||
              content?.type === "reasoning";
            if (thinking) {
              _pendingThinking += text;
            } else {
              _pendingChunk += text;
            }
            _scheduleFlush();
          }
          break;
        }
        case "tool_call":
        case "tool_call_chunk": {
          const tc = update as {
            toolCallId: string;
            title: string;
            kind: string;
            content?: unknown[];
          };
          lastToolCallIdRef.current = tc.toolCallId;
          addOrUpdateToolCall({
            toolCallId: tc.toolCallId,
            title: tc.title,
            kind: tc.kind,
            status: "running",
            content: tc.content,
          });
          break;
        }
        case "tool_call_update": {
          const tc = update as {
            toolCallId: string;
            title?: string;
            kind: string;
            status: string;
            content?: unknown[];
          };
          lastToolCallIdRef.current = tc.toolCallId;
          addOrUpdateToolCall({
            toolCallId: tc.toolCallId,
            title: tc.title ?? "",
            kind: tc.kind,
            status: tc.status,
            content: tc.content,
          });
          break;
        }
        case "available_commands_update": {
          const value = update as Record<string, unknown>;
          setAvailableCommands(
            normalizeCommands(value.availableCommands ?? value.commands ?? value),
          );
          break;
        }
        case "config_option_update": {
          const value = update as { configOptions?: ConfigOption[] };
          if (Array.isArray(value.configOptions)) {
            setConfigOptions(value.configOptions);
          }
          break;
        }
        case "steering_queued":
        case "AgentExecutionUserMessageQueued":
          setSteeringStatus("queued");
          break;
        case "steering_consumed":
        case "AgentExecutionSteeringInjected":
          setSteeringStatus("consumed");
          break;
        case "steering_cleared":
          setSteeringStatus("idle");
          break;
        default:
          // eslint-disable-next-line no-console
          console.debug("[acp] unhandled session/update kind", update.sessionUpdate, update);
      }
    });

    // File activity: emitted by Rust after extracting paths from tool_call events.
    // Store the path for display in the tool call card; do NOT auto-open the panel.
    // The user can click the preview button in the tool call card to open it.
    _state.fileActivity = onFileActivity(({ path }) => {
      setPreviewFilePath(path); // pre-load so panel opens instantly if user clicks
      const toolCallId = lastToolCallIdRef.current;
      if (toolCallId) {
        addFileActivityToToolCall(toolCallId, path);
      }
    });

    _state.status = onAcpStatus((event) => {
      if (event.status === "connected") {
        setAcpStatus("connected");
        return;
      }
      if (event.status === "reconnecting") {
        setAcpStatus("reconnecting");
        return;
      }
      if (event.status === "reconnect_failed") {
        setAcpStatus(_reconnectPromise ? "reconnecting" : "error");
        return;
      }

      _flushPendingNow();
      useApp.getState().endTurn();
      clearPermissions();
      setAcpStatus("disconnected");
      if (shouldAutoReconnect(event)) {
        void retryAcpConnection();
      }
    });
    _state.metadata = onKiroMetadata((e) => applyMetadata(e));
    _state.permission = onPermissionRequest(enqueuePermission);
    _state.commands = onKiroCommands((payload) => {
      setAvailableCommands(normalizeCommands(payload));
    });
    _state.subagents = onKiroSubagents((payload) => {
      setSubagents(normalizeSubagents(payload));
    });
    _state.subagentActivity = onKiroSubagentActivity((payload) => {
      if (!payload || typeof payload !== "object") return;
      const params = payload as Record<string, unknown>;
      const id = String(params.sessionId ?? "");
      const update =
        params.update && typeof params.update === "object"
          ? (params.update as Record<string, unknown>)
          : {};
      if (!id) return;
      const content =
        update.content && typeof update.content === "object"
          ? (update.content as Record<string, unknown>)
          : {};
      const activity: Partial<
        Pick<SubagentView, "activity" | "status" | "title">
      > = {};
      const activityText = content.text ?? update.text;
      if (activityText !== undefined) {
        activity.activity = String(activityText);
      }
      if (update.title !== undefined) {
        activity.title = String(update.title);
      }
      if (update.status !== undefined) {
        activity.status = String(update.status);
      }
      updateSubagentActivity(id, activity);
    });
    _state.mcpStatus = onMcpStatus(setMcpStatus);

    // Intentionally no cleanup: subscriptions live for the app's lifetime.
    // The `subscribed` latch makes StrictMode's double-invoke a no-op.
  }, [
    appendChunk,
    appendThinking,
    addOrUpdateToolCall,
    setAcpStatus,
    applyMetadata,
    setPreviewFilePath,
    addFileActivityToToolCall,
    enqueuePermission,
    clearPermissions,
    setAvailableCommands,
    setConfigOptions,
    setSubagents,
    updateSubagentActivity,
    setMcpStatus,
    setSteeringStatus,
  ]);
}

let _reconnectPromise: Promise<void> | null = null;

function _flushPendingNow() {
  if (_flushTimer !== null) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  if (_pendingChunk && _flushFn) {
    _flushFn(_pendingChunk);
    _pendingChunk = "";
  }
  if (_pendingThinking && _thinkingFlushFn) {
    _thinkingFlushFn(_pendingThinking);
    _pendingThinking = "";
  }
}

function reconnectError(error: unknown): AppError {
  if (
    error &&
    typeof error === "object" &&
    "kind" in error &&
    "message" in error
  ) {
    return error as AppError;
  }
  return {
    kind: "acp_connection_failed",
    message:
      error instanceof Error
        ? error.message
        : String(error ?? "ACP reconnect failed"),
  };
}

/** Trigger the same bounded recovery used after an unexpected process exit. */
export function retryAcpConnection(): Promise<void> {
  if (_reconnectPromise) return _reconnectPromise;

  const initial = useApp.getState();
  const sessionId = initial.sessionId;
  const cwd = initial.workspacePath;
  if ((sessionId === null) !== (cwd === null)) {
    const error: AppError = {
      kind: "session_error",
      message: "Cannot reconnect because the active session has no workspace",
    };
    initial.setAcpStatus("error");
    initial.setError(error);
    return Promise.resolve();
  }

  initial.endTurn();
  initial.clearPermissions();
  initial.setAcpStatus("reconnecting");
  initial.setError(null);

  const task = (async () => {
    try {
      const result = await retryWithDelays(() => {
        const current = useApp.getState();
        return reconnectAcp(
          sessionId,
          cwd,
          current.permissionMode === "auto",
        );
      });
      const current = useApp.getState();
      current.setCliInfo(
        result.cliVersion,
        result.agentCapabilities,
        result.compatibilityWarning,
      );
      if (
        result.session &&
        current.sessionId === sessionId &&
        current.workspacePath === cwd
      ) {
        current.hydrateFromSessionResult(result.session);
      }
      current.setAcpStatus("connected");
      current.setError(null);
    } catch (error) {
      const current = useApp.getState();
      current.setAcpStatus("error");
      current.setError(reconnectError(error));
    }
  })();

  _reconnectPromise = task;
  void task.finally(() => {
    if (_reconnectPromise === task) _reconnectPromise = null;
  });
  return task;
}

/** Test / teardown helper — not used by the app itself. */
export async function _unsubscribeAcpForTests() {
  _state.subscribed = false;
  if (_state.update) (await _state.update)();
  if (_state.status) (await _state.status)();
  if (_state.metadata) (await _state.metadata)();
  if (_state.fileActivity) (await _state.fileActivity)();
  if (_state.permission) (await _state.permission)();
  if (_state.commands) (await _state.commands)();
  if (_state.subagents) (await _state.subagents)();
  if (_state.subagentActivity) (await _state.subagentActivity)();
  if (_state.mcpStatus) (await _state.mcpStatus)();
  _state.update = null;
  _state.status = null;
  _state.metadata = null;
  _state.fileActivity = null;
  _state.permission = null;
  _state.commands = null;
  _state.subagents = null;
  _state.subagentActivity = null;
  _state.mcpStatus = null;
}
