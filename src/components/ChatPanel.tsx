import { useEffect, useRef } from "react";
import { useApp } from "../stores/app-store";
import { MessageBubble } from "./MessageBubble";
import { InputBar } from "./InputBar";
import { KiroMascot } from "./KiroMark";

export function ChatPanel() {
  const messages = useApp((s) => s.messages);
  const error = useApp((s) => s.error);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="flex h-full flex-col kiro-ambient">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-3 mt-20 text-center">
              <KiroMascot size={96} />
              <p className="text-sm text-fg-muted max-w-sm">
                Ready when you are. Ask about the code, request changes, or
                just say hi.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              <span className="font-medium">{error.kind}:</span> {error.message}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <InputBar />
    </div>
  );
}
