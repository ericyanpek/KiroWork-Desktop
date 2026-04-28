import { useEffect, useRef } from "react";
import { useApp } from "../stores/app-store";
import { MessageBubble } from "./MessageBubble";
import { InputBar } from "./InputBar";

export function ChatPanel() {
  const messages = useApp((s) => s.messages);
  const error = useApp((s) => s.error);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="text-center text-sm text-gray-400 mt-20">
              Start the conversation — ask Kiro about your workspace.
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
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
