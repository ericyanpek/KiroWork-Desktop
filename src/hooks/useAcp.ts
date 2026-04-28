import { useEffect } from "react";
import { onAcpStatus, onSessionUpdate } from "../lib/tauri-bridge";
import { useApp } from "../stores/app-store";

/**
 * Wires Tauri events into the zustand store. Mount once, high in the tree.
 *
 * `session/update` is the ONLY streaming notification — the design doc's
 * separate `AgentMessageChunk` / `ToolCall` / `TurnEnd` methods do not exist.
 * End-of-turn is signalled by the `session/prompt` response resolving, not
 * by any notification.
 */
export function useAcp() {
  const appendChunk = useApp((s) => s.appendChunk);
  const addOrUpdateToolCall = useApp((s) => s.addOrUpdateToolCall);
  const setAcpStatus = useApp((s) => s.setAcpStatus);
  const currentSessionId = useApp((s) => s.sessionId);

  useEffect(() => {
    let unsubUpdate: (() => void) | undefined;
    let unsubStatus: (() => void) | undefined;

    onSessionUpdate(({ sessionId, update }) => {
      // Drop updates for stale sessions if the user switched workspaces.
      if (currentSessionId && sessionId !== currentSessionId) return;

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
          };
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
          // Forward-compat: log unknown kinds but do not break.
          // eslint-disable-next-line no-console
          console.debug("[acp] unhandled session/update kind", update.sessionUpdate, update);
      }
    }).then((u) => {
      unsubUpdate = u;
    });

    onAcpStatus((s) => setAcpStatus(s)).then((u) => {
      unsubStatus = u;
    });

    return () => {
      unsubUpdate?.();
      unsubStatus?.();
    };
  }, [appendChunk, addOrUpdateToolCall, setAcpStatus, currentSessionId]);
}
