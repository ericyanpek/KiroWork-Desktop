import { useEffect, useRef, useState } from "react";
import { useApp } from "../stores/app-store";
import { MessageBubble } from "./MessageBubble";
import { InputBar } from "./InputBar";
import { KiroMascot } from "./KiroMark";

const QUICK_STARTS = [
  { label: "Summarize this repo", prompt: "Give me a brief overview of this codebase — what it does, the main entry points, and the key technologies used." },
  { label: "Review git diff", prompt: "Review the current uncommitted git changes. Summarize what changed and flag any potential issues." },
  { label: "Run tests", prompt: "Find and run the test suite. Summarize the results and flag any failures." },
  { label: "Find TODOs", prompt: "Search the codebase for TODO and FIXME comments. List them with file and line number." },
];

export function ChatPanel() {
  const messages = useApp((s) => s.messages);
  const error = useApp((s) => s.error);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [quickInput, setQuickInput] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 pt-24 pb-40">
        <div className="mx-auto max-w-3xl flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-4 mt-16 text-center">
              <KiroMascot size={88} />
              <p className="text-sm text-fg-muted max-w-sm">
                Ready when you are. Ask about the code, request changes, or just say hi.
              </p>
              <div className="grid grid-cols-2 gap-2 mt-2 w-full max-w-md">
                {QUICK_STARTS.map((qs) => (
                  <button
                    key={qs.label}
                    onClick={() => setQuickInput(qs.prompt)}
                    className="text-left px-3 py-2.5 rounded-xl border border-border/60 bg-bg-elevated/60 hover:bg-bg-elevated hover:border-accent/40 hover:shadow-sm text-[12px] text-fg-muted hover:text-fg transition-all duration-150"
                  >
                    {qs.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {error && (
            <div className="rounded-lg border border-status-error/25 bg-status-error/8 px-3 py-2.5 text-sm text-status-error">
              <span className="font-medium">{error.kind}:</span> {error.message}
            </div>
          )}
          {/* scroll-mb reserves space below the anchor so auto-scroll leaves
           *  the latest bubble visually above the floating InputBar pill. */}
          <div ref={bottomRef} className="scroll-mb-32" />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 pointer-events-none">
        <InputBar
          initialText={quickInput}
          onInitialTextConsumed={() => setQuickInput(null)}
        />
      </div>
    </div>
  );
}
