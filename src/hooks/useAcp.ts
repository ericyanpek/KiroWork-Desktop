import { useEffect, useRef } from "react";
import { onAcpStatus, onFileActivity, onKiroMetadata, onSessionUpdate } from "../lib/tauri-bridge";
import { useApp } from "../stores/app-store";

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
  g.__kiroAcpUnsub = { subscribed: false, update: null, status: null, metadata: null, fileActivity: null };
}
const _state = g.__kiroAcpUnsub as {
  subscribed: boolean;
  update: Promise<() => void> | null;
  status: Promise<() => void> | null;
  metadata: Promise<() => void> | null;
  fileActivity: Promise<() => void> | null;
};

export function useAcp() {
  const appendChunk = useApp((s) => s.appendChunk);
  const addOrUpdateToolCall = useApp((s) => s.addOrUpdateToolCall);
  const setAcpStatus = useApp((s) => s.setAcpStatus);
  const applyMetadata = useApp((s) => s.applyMetadata);
  const setPreviewFilePath = useApp((s) => s.setPreviewFilePath);
  const addFileActivityToToolCall = useApp((s) => s.addFileActivityToToolCall);

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
        case "agent_message_chunk": {
          const text = (update as { content: { text: string } }).content?.text ?? "";
          if (text) appendChunk(text);
          break;
        }
        case "tool_call": {
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

    _state.status = onAcpStatus((s) => setAcpStatus(s));
    _state.metadata = onKiroMetadata((e) => applyMetadata(e));

    // Intentionally no cleanup: subscriptions live for the app's lifetime.
    // The `subscribed` latch makes StrictMode's double-invoke a no-op.
  }, [appendChunk, addOrUpdateToolCall, setAcpStatus, applyMetadata, setPreviewFilePath, addFileActivityToToolCall]);
}

/** Test / teardown helper — not used by the app itself. */
export async function _unsubscribeAcpForTests() {
  _state.subscribed = false;
  if (_state.update) (await _state.update)();
  if (_state.status) (await _state.status)();
  if (_state.metadata) (await _state.metadata)();
  if (_state.fileActivity) (await _state.fileActivity)();
  _state.update = null;
  _state.status = null;
  _state.metadata = null;
  _state.fileActivity = null;
}
