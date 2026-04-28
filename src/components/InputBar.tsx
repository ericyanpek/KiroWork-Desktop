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
    <div className="border-t bg-white px-4 py-3">
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
          placeholder={sessionId ? "Send a message…" : "Open a folder to start"}
          rows={2}
          disabled={!sessionId}
          className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        />
        {isStreaming ? (
          <button
            onClick={stop}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!sessionId || !text.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Send
          </button>
        )}
      </div>
      <div className="mx-auto max-w-3xl text-xs text-gray-400 mt-1">
        Enter to send · Shift+Enter for newline · Cmd/Ctrl+Enter also sends
      </div>
    </div>
  );
}
