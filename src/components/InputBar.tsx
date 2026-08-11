import { useState, useRef, useEffect, type ClipboardEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useApp } from "../stores/app-store";
import {
  executeCommand,
  readFileBytes,
  sessionCancel,
  sessionPrompt,
  sessionSteer,
} from "../lib/tauri-bridge";
import type { AppError, ContentBlock } from "../types/acp";

type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  /** base64-encoded bytes for the ACP image block. */
  base64: string;
  /** data URL for the thumbnail preview. */
  previewDataUrl: string;
};

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp"];

function rid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function mimeFromExt(name: string): string {
  const i = name.lastIndexOf(".");
  const ext = (i >= 0 ? name.slice(i + 1) : "").toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

/** Convert Uint8Array to base64 in chunks (browser btoa balks on large
 *  strings; this keeps memory bounded). */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function blobToBase64(blob: Blob): Promise<{ base64: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const comma = dataUrl.indexOf(",");
      resolve({ base64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, dataUrl });
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function PlusIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M8 3.5v9M3.5 8h9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function parseSlashCommand(text: string): {
  command: string;
  args?: Record<string, unknown>;
} {
  const [head, ...rest] = text.trim().split(/\s+/);
  const value = rest.join(" ").trim();
  return {
    command: head.replace(/^\//, ""),
    args: value ? { value } : undefined,
  };
}

function commandResultText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const value = result as Record<string, unknown>;
  if (typeof value.text === "string") return value.text;
  if (typeof value.message === "string") return value.message;
  if (value.data && typeof value.data === "object") {
    return `\`\`\`json\n${JSON.stringify(value.data, null, 2)}\n\`\`\``;
  }
  return "";
}

export function InputBar({ initialText, onInitialTextConsumed }: {
  initialText?: string | null;
  onInitialTextConsumed?: () => void;
} = {}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialText) {
      setText(initialText);
      taRef.current?.focus();
      onInitialTextConsumed?.();
    }
  }, [initialText, onInitialTextConsumed]);
  // Tracks when composition last ended (ms). During composition this is Infinity.
  // Blocks the confirming Enter for 50 ms after compositionend — needed because
  // on macOS WKWebView compositionend fires before keydown, so setTimeout(0)
  // is too short and isComposing is already false by the time keydown arrives.
  const compositionEndedAt = useRef(0);
  const isStreaming = useApp((s) => s.isStreaming);
  const acpStatus = useApp((s) => s.acpStatus);
  const sessionId = useApp((s) => s.sessionId);
  const addUserMessage = useApp((s) => s.addUserMessage);
  const startTurn = useApp((s) => s.startTurn);
  const endTurn = useApp((s) => s.endTurn);
  const setError = useApp((s) => s.setError);
  const addSteeringMessage = useApp((s) => s.addSteeringMessage);
  const appendChunk = useApp((s) => s.appendChunk);
  const availableCommands = useApp((s) => s.availableCommands);
  const steeringStatus = useApp((s) => s.steeringStatus);
  const setSteeringStatus = useApp((s) => s.setSteeringStatus);

  useEffect(() => {
    if (!initialText) taRef.current?.focus();
  }, []);

  const commandQuery = text.startsWith("/")
    ? text.slice(1).split(/\s+/, 1)[0].toLowerCase()
    : "";
  const commandMatches = text.startsWith("/")
    ? availableCommands
        .filter((command) => command.name.toLowerCase().includes(commandQuery))
        .slice(0, 8)
    : [];
  const commandMenuOpen =
    commandMatches.length > 0 && !text.slice(1).includes(" ");

  useEffect(() => {
    setCommandIndex(0);
  }, [commandQuery]);

  function canSend(): boolean {
    if (!sessionId || acpStatus !== "connected") return false;
    if (isStreaming) return text.trim().length > 0;
    return text.trim().length > 0 || attachments.length > 0;
  }

  function chooseCommand(index: number) {
    const command = commandMatches[index];
    if (!command) return;
    setText(`/${command.name} `);
    requestAnimationFrame(() => taRef.current?.focus());
  }

  async function submit() {
    if (!canSend()) return;
    const trimmed = text.trim();
    if (isStreaming) {
      setText("");
      addSteeringMessage(trimmed);
      try {
        await sessionSteer(sessionId!, trimmed);
      } catch (e) {
        setSteeringStatus("idle");
        setError(e as AppError);
      }
      return;
    }

    if (trimmed.startsWith("/") && attachments.length === 0) {
      const parsed = parseSlashCommand(trimmed);
      setText("");
      addUserMessage(trimmed);
      startTurn();
      try {
        const result = await executeCommand(
          sessionId!,
          parsed.command,
          parsed.args,
        );
        const resultText = commandResultText(result);
        const messages = useApp.getState().messages;
        const last = messages[messages.length - 1];
        if (resultText && last?.role === "assistant" && !last.text) {
          appendChunk(resultText);
        }
      } catch (e) {
        setError(e as AppError);
      } finally {
        endTurn();
      }
      return;
    }

    const prompt: ContentBlock[] = [
      ...attachments.map((a) => ({
        type: "image" as const,
        data: a.base64,
        mimeType: a.mimeType,
      })),
      ...(trimmed ? [{ type: "text" as const, text: trimmed }] : []),
    ];
    // User bubble preview — text + indicator of attachments.
    const userText =
      trimmed +
      (attachments.length
        ? (trimmed ? "\n" : "") +
          `(${attachments.length} image${attachments.length === 1 ? "" : "s"} attached)`
        : "");
    setText("");
    setAttachments([]);
    addUserMessage(userText);
    startTurn();
    try {
      await sessionPrompt(sessionId!, prompt);
    } catch (e) {
      setError(e as AppError);
    } finally {
      endTurn();
      setSteeringStatus("idle");
    }
  }

  async function stop() {
    if (!sessionId) return;
    try {
      await sessionCancel(sessionId);
      setSteeringStatus("idle");
    } catch (e) {
      setError(e as AppError);
    }
  }

  async function pickFiles() {
    setAttaching(true);
    try {
      const picked = await openDialog({
        multiple: true,
        filters: [{ name: "Image", extensions: IMAGE_EXTS }],
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      const next: Attachment[] = [];
      for (const p of paths) {
        try {
          const bytes = await readFileBytes(p);
          const base64 = bytesToBase64(bytes);
          const mimeType = mimeFromExt(p);
          const dataUrl = `data:${mimeType};base64,${base64}`;
          const name = p.split("/").pop() ?? "image";
          next.push({ id: rid(), name, mimeType, base64, previewDataUrl: dataUrl });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[attach] failed to read", p, e);
        }
      }
      if (next.length > 0) {
        setAttachments((prev) => [...prev, ...next]);
      }
    } finally {
      setAttaching(false);
    }
  }

  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) images.push(f);
      }
    }
    if (images.length === 0) return;
    e.preventDefault();
    const next: Attachment[] = [];
    for (const f of images) {
      try {
        const { base64, dataUrl } = await blobToBase64(f);
        next.push({
          id: rid(),
          name: f.name || "pasted-image",
          mimeType: f.type || "image/png",
          base64,
          previewDataUrl: dataUrl,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[attach] paste failed", err);
      }
    }
    if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="relative px-4 pt-6 pb-4 bg-gradient-to-t from-bg via-bg/92 to-transparent pointer-events-none">
      <div className="mx-auto max-w-3xl pointer-events-auto">
        {commandMenuOpen && (
          <div className="mb-2 overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-xl">
            {commandMatches.map((command, index) => (
              <button
                key={command.name}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseCommand(index)}
                className={`flex w-full items-start gap-3 px-3 py-2 text-left ${
                  index === commandIndex
                    ? "bg-accent/10 text-fg"
                    : "text-fg-muted hover:bg-bg-muted"
                }`}
              >
                <span className="font-mono text-xs text-accent">
                  /{command.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-fg-subtle">
                  {command.description}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2.5 px-1">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="relative w-11 h-11 rounded-lg border border-border/70 overflow-hidden bg-bg-muted group shadow-sm"
                title={a.name}
              >
                <img src={a.previewDataUrl} alt={a.name} className="w-full h-full object-cover" />
                <button
                  onClick={() => removeAttachment(a.id)}
                  className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={`Remove ${a.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main input container — floating pill.
         *  isolation:isolate gives it its own stacking context so backdrop-blur
         *  doesn't re-rasterize on every message stream behind it. Avoiding
         *  contain:paint / will-change-transform here because in WKWebView
         *  they can interfere with pointer-event dispatch to nested buttons. */}
        <div className={`flex items-end gap-0 rounded-2xl border backdrop-blur-md isolate transition-colors duration-150 bg-bg-elevated/85 shadow-lg shadow-black/10 dark:shadow-black/30 ${
          sessionId && acpStatus === "connected"
            ? "border-border/70 focus-within:border-accent/60 focus-within:shadow-accent/10"
            : "border-border/40 opacity-60"
        }`}>
          {/* Attach button — sits left, vertically centered */}
          <button
            onClick={pickFiles}
            disabled={
              !sessionId ||
              acpStatus !== "connected" ||
              attaching ||
              isStreaming
            }
            title="Attach image"
            aria-label="Attach image"
            className="self-center flex-shrink-0 ml-1.5 w-8 h-8 flex items-center justify-center rounded-full text-fg-subtle/70 hover:text-fg hover:bg-bg-muted/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
          >
            <PlusIcon className="w-[18px] h-[18px]" />
          </button>

          {/* Textarea */}
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={handlePaste}
            onCompositionStart={() => { compositionEndedAt.current = Infinity; }}
            onCompositionEnd={() => { compositionEndedAt.current = Date.now(); }}
            onKeyDown={(e) => {
              if (Date.now() - compositionEndedAt.current < 50) return;
              if (commandMenuOpen && e.key === "ArrowDown") {
                e.preventDefault();
                setCommandIndex((index) =>
                  Math.min(index + 1, commandMatches.length - 1),
                );
                return;
              }
              if (commandMenuOpen && e.key === "ArrowUp") {
                e.preventDefault();
                setCommandIndex((index) => Math.max(index - 1, 0));
                return;
              }
              if (commandMenuOpen && e.key === "Tab") {
                e.preventDefault();
                chooseCommand(commandIndex);
                return;
              }
              if (commandMenuOpen && e.key === "Enter") {
                const selected = commandMatches[commandIndex];
                if (
                  selected &&
                  commandQuery === selected.name.toLowerCase()
                ) {
                  e.preventDefault();
                  submit();
                } else {
                  e.preventDefault();
                  chooseCommand(commandIndex);
                }
                return;
              }
              if (commandMenuOpen && e.key === "Escape") {
                e.preventDefault();
                setText("");
                return;
              }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              !sessionId
                ? "Open a folder to start"
                : acpStatus === "reconnecting"
                  ? "Reconnecting to Kiro CLI…"
                  : acpStatus !== "connected"
                    ? "Kiro CLI is disconnected"
                : isStreaming
                  ? "Steer the current turn…"
                  : "Ask Kiro…"
            }
            rows={2}
            disabled={!sessionId}
            className="flex-1 resize-none bg-transparent px-2 py-2.5 text-[13px] text-fg placeholder:text-fg-subtle/50 focus:outline-none leading-relaxed"
          />

          {/* Send / Stop — sits right, vertically centered */}
          <div className="self-center flex-shrink-0 mr-2">
            {isStreaming ? (
              <div className="flex items-center gap-1">
                {text.trim() && (
                  <button
                    onClick={submit}
                    title="Steer current turn"
                    aria-label="Steer current turn"
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-accent text-accent-foreground hover:bg-accent-strong transition-colors duration-150"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 8h9M9 4l4 4-4 4" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={stop}
                  title="Stop generation"
                  aria-label="Stop generation"
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-status-error/15 text-status-error hover:bg-status-error/25 transition-colors duration-150"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                onClick={submit}
                disabled={!canSend()}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-accent text-accent-foreground hover:bg-accent-strong disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v10M3 8l5-5 5 5" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="text-[11px] text-fg-subtle/50 mt-1.5 px-1 select-none">
          {acpStatus === "reconnecting"
            ? "Restoring the active session…"
            : acpStatus !== "connected"
              ? "Connection unavailable"
            : isStreaming
            ? steeringStatus === "consumed"
              ? "Steering applied"
              : steeringStatus === "queued"
                ? "Steering queued"
                : "Enter to steer the current turn"
            : "Enter to send · type / for commands · paste or attach images"}
        </div>
      </div>
    </div>
  );
}
