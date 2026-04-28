import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../stores/app-store";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const align = isUser ? "items-end" : "items-start";
  const bubbleColor = isUser
    ? "bg-blue-600 text-white"
    : "bg-white text-gray-800 border border-gray-200";
  return (
    <div className={`flex flex-col ${align} gap-1`}>
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="w-full max-w-3xl flex flex-col gap-1 px-1">
          {message.toolCalls.map((tc) => (
            <div
              key={tc.toolCallId}
              className="text-xs text-gray-500 font-mono flex items-center gap-2"
            >
              <span className="inline-block w-2 h-2 rounded-full"
                style={{
                  backgroundColor:
                    tc.status === "completed"
                      ? "#16a34a"
                      : tc.status === "failed"
                        ? "#dc2626"
                        : "#d97706",
                }}
              />
              <span className="opacity-70">Using tool:</span>
              <span>{tc.title || tc.kind}</span>
              <span className="text-gray-400">({tc.status})</span>
            </div>
          ))}
        </div>
      )}
      <div
        className={`max-w-3xl rounded-2xl px-4 py-2 text-sm leading-relaxed shadow-sm ${bubbleColor}`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap break-words">{message.text}</span>
        ) : (
          <div className="prose prose-sm max-w-none prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-code:before:hidden prose-code:after:hidden">
            {message.text ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
            ) : (
              <span className="text-gray-400 italic">
                {message.streaming ? "…" : ""}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
