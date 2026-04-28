import { useEffect, useRef } from "react";
import { onAcpStatus, onSessionUpdate } from "../lib/tauri-bridge";
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

let subscribed = false;
let unsubUpdate: Promise<() => void> | null = null;
let unsubStatus: Promise<() => void> | null = null;

export function useAcp() {
  const appendChunk = useApp((s) => s.appendChunk);
  const addOrUpdateToolCall = useApp((s) => s.addOrUpdateToolCall);
  const setAcpStatus = useApp((s) => s.setAcpStatus);

  // Latest-value ref so updates for the active session aren't dropped without
  // putting sessionId in effect deps (which would re-subscribe on every change).
  const currentSessionIdRef = useRef<string | null>(null);
  const sessionId = useApp((s) => s.sessionId);
  useEffect(() => {
    currentSessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (subscribed) return;
    subscribed = true;

    unsubUpdate = onSessionUpdate(({ sessionId: incoming, update }) => {
      const active = currentSessionIdRef.current;
      if (active && incoming !== active) return;

      switch (update.sessionUpdate) {
        case "agent_message_chunk": {
          const text = (update as { content: { text: string } }).content?.text ?? "";
          if (text) appendChunk(text);
          break;
        }
        case "tool_call": {
          const tc = update as { toolCallId: string; title: string; kind: string };
          addOrUpdateToolCall({
            toolCallId: tc.toolCallId,
            title: tc.title,
            kind: tc.kind,
            status: "running",
          });
          break;
        }
        case "tool_call_update": {
          const tc = update as {
            toolCallId: string;
            title?: string;
            kind: string;
            status: string;
          };
          addOrUpdateToolCall({
            toolCallId: tc.toolCallId,
            title: tc.title ?? "",
            kind: tc.kind,
            status: tc.status,
          });
          break;
        }
        default:
          // eslint-disable-next-line no-console
          console.debug("[acp] unhandled session/update kind", update.sessionUpdate, update);
      }
    });

    unsubStatus = onAcpStatus((s) => setAcpStatus(s));

    // Intentionally no cleanup: subscriptions live for the app's lifetime.
    // The `subscribed` latch makes StrictMode's double-invoke a no-op.
  }, [appendChunk, addOrUpdateToolCall, setAcpStatus]);
}

/** Test / teardown helper — not used by the app itself. */
export async function _unsubscribeAcpForTests() {
  subscribed = false;
  if (unsubUpdate) (await unsubUpdate)();
  if (unsubStatus) (await unsubStatus)();
  unsubUpdate = null;
  unsubStatus = null;
}
