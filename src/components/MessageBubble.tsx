import { memo, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { open } from "@tauri-apps/plugin-shell";
import type { Message } from "../stores/app-store";
import { useApp } from "../stores/app-store";
import { CodeBlock } from "./CodeBlock";
import { ToolCallCard } from "./ToolCallCard";

// Convert OSC 8 hyperlink escape sequences to Markdown links.
// Format: \e]8;;<url>\e\\<label>\e]8;;\e\\
function osc8ToMarkdown(text: string): string {
  return text.replace(
    /\x1b]8;;([^\x1b]*)\x1b\\([^\x1b]*)\x1b]8;;\x1b\\/g,
    (_, url, label) => `[${label}](${url})`
  );
}

// Convert bare absolute file paths to file:// markdown links so they become
// clickable in the panel. Only matches paths that look like real filesystem
// paths (start with / or ~/, contain no whitespace, have a plausible extension
// or end with /). Skips paths already inside a markdown link or code span.
function filePathsToLinks(text: string): string {
  // Match absolute paths: /foo/bar or ~/foo/bar, optionally followed by :line
  // Negative lookbehind: skip if preceded by ( (already a link target) or `
  return text.replace(
    /(?<![(`])((?:~\/|\/)[^\s`"'<>()[\]{}*?|]+)/g,
    (match) => {
      // Only linkify if it has an extension or ends with /
      if (/\.[a-z0-9]{1,10}$/i.test(match) || match.endsWith("/")) {
        const display = match.replace(/^.*\/([^/]+)$/, "$1") || match;
        return `[${display}](file://${match.replace(/^~/, "")})`;
      }
      return match;
    }
  );
}

function preprocessText(text: string): string {
  return filePathsToLinks(osc8ToMarkdown(text));
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(console.error);
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy"
      aria-label="Copy message"
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-fg-subtle/50 hover:text-fg-subtle hover:bg-bg-muted/60 transition-colors duration-150 select-none"
    >
      {copied ? (
        <>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8l3.5 3.5L13 4" />
          </svg>
          <span>Copied</span>
        </>
      ) : (
        <>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="5" width="8" height="9" rx="1.5" />
            <path d="M3 11V3a1 1 0 0 1 1-1h8" />
          </svg>
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

function makeMarkdownComponents(
  onFilePath: (path: string) => void,
): Components {
  return {
  a({ href, children }) {
    if (!href) return <span>{children}</span>;
    if (href.startsWith("file://")) {
      const path = decodeURIComponent(href.slice(7));
      return (
        <button
          onClick={() => onFilePath(path)}
          className="cursor-pointer text-accent underline underline-offset-2 hover:text-accent-strong transition-colors"
          title={path}
        >
          {children}
        </button>
      );
    }
    const isWeb = href.startsWith("http://") || href.startsWith("https://");
    if (!isWeb) return <span className="cursor-default" title={href}>{children}</span>;
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          open(href).catch(console.error);
        }}
        className="cursor-pointer"
        title={href}
      >
        {children}
      </a>
    );
  },
  code({ className, children, ...rest }: React.ComponentPropsWithoutRef<"code"> & { className?: string }) {
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
}

export const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const setPreviewFilePath = useApp((s) => s.setPreviewFilePath);
  const setFilePanelOpen = useApp((s) => s.setFilePanelOpen);
  const align = isUser ? "items-end" : "items-start";
  const bubbleClass = isUser
    ? "bg-accent/90 text-accent-foreground rounded-2xl px-4 py-3"
    : "border-l-2 border-accent/30 pl-4 pr-2 py-1";

  const openFile = useMemo(() => (path: string) => {
    setPreviewFilePath(path);
    setFilePanelOpen(true);
  }, [setPreviewFilePath, setFilePanelOpen]);

  const markdownComponents = useMemo(() => makeMarkdownComponents(openFile), [openFile]);

  return (
    <div className={`group/msg flex flex-col ${align} gap-1`}>
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="w-full max-w-3xl flex flex-col gap-2 px-1">
          {message.toolCalls.map((tc) => (
            <ToolCallCard key={tc.toolCallId} call={tc} />
          ))}
        </div>
      )}
      <div
        className={`leading-relaxed text-[13px] ${isUser ? "max-w-[65%]" : "w-full max-w-3xl"} ${bubbleClass}`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{message.text}</span>
        ) : (
          <div className="kiro-prose prose prose-sm max-w-none dark:prose-invert">
            {message.text ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {preprocessText(message.text)}
              </ReactMarkdown>
            ) : (
              <span className="text-fg-subtle italic">
                {message.streaming ? "…" : ""}
              </span>
            )}
          </div>
        )}
      </div>
      {/* Copy button — visible on hover, hidden while streaming */}
      {!message.streaming && message.text && (
        <div className={`opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150 ${isUser ? "self-end" : "self-start pl-4"}`}>
          <CopyButton text={message.text} />
        </div>
      )}
    </div>
  );
});
