import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../stores/app-store";
import { CodeBlock } from "./CodeBlock";

// Markdown `code` renderer: inline code keeps the Kiro prose styling,
// fenced code blocks go through shiki via CodeBlock. react-markdown v10
// no longer passes `inline`; a fenced block gets a `className` with
// `language-xxx`, inline code does not.
const markdownComponents: Components = {
  code({ className, children, ...rest }) {
    const raw = String(children ?? "");
    const match = /language-(\w+)/.exec(className ?? "");
    const looksFenced = !!match || raw.includes("\n");
    if (!looksFenced) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    }
    return <CodeBlock lang={match?.[1]} code={raw.replace(/\n$/, "")} />;
  },
};

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const align = isUser ? "items-end" : "items-start";
  const bubbleClass = isUser
    ? "bg-accent text-accent-foreground"
    : "bg-bg-elevated text-fg border border-border";

  return (
    <div className={`flex flex-col ${align} gap-1`}>
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="w-full max-w-3xl flex flex-col gap-1 px-1">
          {message.toolCalls.map((tc) => (
            <div
              key={tc.toolCallId}
              className="text-xs text-fg-subtle font-mono flex items-center gap-2"
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{
                  backgroundColor:
                    tc.status === "completed"
                      ? "hsl(149 65% 52%)"
                      : tc.status === "failed"
                        ? "hsl(353 94% 62%)"
                        : "hsl(50 86% 57%)",
                  boxShadow:
                    tc.status === "running"
                      ? "0 0 8px hsl(50 86% 57% / 0.6)"
                      : undefined,
                }}
              />
              <span className="opacity-70">Tool</span>
              <span className="text-fg-muted">{tc.title || tc.kind}</span>
              <span className="text-fg-subtle">({tc.status})</span>
            </div>
          ))}
        </div>
      )}
      <div
        className={`max-w-3xl rounded-2xl px-4 py-2 text-sm leading-relaxed shadow-sm ${bubbleClass}`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap break-words">{message.text}</span>
        ) : (
          <div className="kiro-prose prose prose-sm max-w-none dark:prose-invert">
            {message.text ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {message.text}
              </ReactMarkdown>
            ) : (
              <span className="text-fg-subtle italic">
                {message.streaming ? "…" : ""}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
