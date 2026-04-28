import { useState, useRef, useEffect, type ClipboardEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useApp } from "../stores/app-store";
import { readFileBytes, sessionCancel, sessionPrompt } from "../lib/tauri-bridge";
import type { ContentBlock } from "../types/acp";

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

function PaperclipIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M10.5 5L6.4 9.1a2 2 0 1 0 2.8 2.8l5-5a4 4 0 1 0-5.6-5.6L3 7a6 6 0 0 0 8.5 8.5L14 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function InputBar() {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);
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

  function canSend(): boolean {
    if (isStreaming || !sessionId) return false;
    return text.trim().length > 0 || attachments.length > 0;
  }

  async function submit() {
    if (!canSend()) return;
    const trimmed = text.trim();
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
    <div className="border-t border-border bg-bg-elevated px-4 py-3">
      {attachments.length > 0 && (
        <div className="mx-auto max-w-3xl flex flex-wrap gap-2 mb-2">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="relative w-12 h-12 rounded-md border border-border overflow-hidden bg-bg-muted group"
              title={a.name}
            >
              <img
                src={a.previewDataUrl}
                alt={a.name}
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => removeAttachment(a.id)}
                className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center bg-black/70 text-white text-[10px] rounded-bl opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Remove ${a.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mx-auto max-w-3xl flex items-end gap-2">
        <button
          onClick={pickFiles}
          disabled={!sessionId || attaching}
          title="Attach image"
          className="h-[38px] w-[38px] flex items-center justify-center rounded-lg border border-border bg-bg text-fg-muted hover:text-fg hover:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <PaperclipIcon />
        </button>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={handlePaste}
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
            disabled={!canSend()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-strong hover:text-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        )}
      </div>
      <div className="mx-auto max-w-3xl text-xs text-fg-subtle mt-1">
        Enter to send · Shift+Enter for newline · 📎 or paste images
      </div>
    </div>
  );
}
