import { useState, useRef, useEffect } from "react";
import { useApp } from "../stores/app-store";
import { sessionCancel, sessionPrompt } from "../lib/tauri-bridge";

export function InputBar() {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useApp((s) => s.isStreaming);
  const sessionId = useApp((s) => s.sessionId);
  const addUserMessage = useApp((s) => s.addUserMessage);
  const startTurn = useApp((s) => s.startTurn);
  const endTurn = useApp((s) => s.endTurn);
  const setError = useApp((s) => s.setError);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || !sessionId) return;
    setText("");
    addUserMessage(trimmed);
    startTurn();
    try {
      await sessionPrompt(sessionId, [{ type: "text", text: trimmed }]);
    } catch (e) {
      setError(e as never);
    } finally {
      endTurn();
    }
  }

  async function stop() {
    if (!sessionId) return;
    try {
      await sessionCancel(sessionId);
    } catch (e) {
      setError(e as never);
    }
  }

  return (
    <div className="border-t border-border bg-bg-elevated px-4 py-3">
      <div className="mx-auto max-w-3xl flex items-end gap-2">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={sessionId ? "Ask Kiro…" : "Open a folder to start"}
          rows={2}
          disabled={!sessionId}
          className="flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            onClick={stop}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!sessionId || !text.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-strong hover:text-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        )}
      </div>
      <div className="mx-auto max-w-3xl text-xs text-fg-subtle mt-1">
        Enter to send · Shift+Enter for newline
      </div>
    </div>
  );
}
