import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useApp } from "../stores/app-store";
import { readFileBytes } from "../lib/tauri-bridge";
import { CodeBlock } from "./CodeBlock";

function guessLang(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", rs: "rust", sh: "shellscript", bash: "bash",
    json: "json", yaml: "yaml", yml: "yaml", md: "markdown",
    html: "html", css: "css", sql: "sql", svg: "html",
  };
  return ext ? map[ext] : undefined;
}

function guessImageMime(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
    ico: "image/x-icon", tiff: "image/tiff", tif: "image/tiff",
    avif: "image/avif",
  };
  return ext ? (map[ext] ?? null) : null;
}

function supportsDualView(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "md" || ext === "markdown" || ext === "html" || ext === "htm" || ext === "svg";
}

function basename(p: string): string {
  if (!p) return "";
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

type ViewMode = "source" | "preview";

type LoadState =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "ok"; text: string }
  | { type: "image"; blobUrl: string }
  | { type: "binary" }
  | { type: "error"; message: string };

function MarkdownPreview({ text }: { text: string }) {
  return (
    <div className="kiro-prose prose prose-sm max-w-none dark:prose-invert text-[12px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function HtmlPreview({ text }: { text: string }) {
  return (
    <iframe
      srcDoc={text}
      sandbox="allow-scripts"
      className="w-full min-h-[400px] rounded border border-border/40 bg-white"
      title="HTML preview"
    />
  );
}

function SvgPreview({ text }: { text: string }) {
  const [url] = useState(() => {
    const blob = new Blob([text], { type: "image/svg+xml" });
    return URL.createObjectURL(blob);
  });
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="flex items-center justify-center p-4 min-h-[120px]">
      <img src={url} alt="SVG preview" className="max-w-full max-h-[400px] object-contain" />
    </div>
  );
}

// </>  icon
function SourceIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4L1 8l4 4M11 4l4 4-4 4M9 3l-2 10" />
    </svg>
  );
}

// eye icon
function PreviewIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

export function FilePanel() {
  const filePath = useApp((s) => s.previewFilePath);
  const [load, setLoad] = useState<LoadState>({ type: "idle" });
  const [viewMode, setViewMode] = useState<ViewMode>("preview");

  useEffect(() => { setViewMode("preview"); }, [filePath]);

  useEffect(() => {
    if (!filePath) { setLoad({ type: "idle" }); return; }
    setLoad({ type: "loading" });
    let cancelled = false;
    let blobUrl: string | null = null;

    readFileBytes(filePath)
      .then((bytes) => {
        if (cancelled) return;
        const mime = guessImageMime(filePath);
        if (mime) {
          const blob = new Blob([bytes], { type: mime });
          blobUrl = URL.createObjectURL(blob);
          setLoad({ type: "image", blobUrl });
          return;
        }
        const sample = bytes.slice(0, 512);
        let nonPrint = 0;
        for (const b of sample) {
          if (b < 9 || (b > 13 && b < 32) || b === 127) nonPrint++;
        }
        if (sample.length > 0 && nonPrint / sample.length > 0.1) {
          setLoad({ type: "binary" }); return;
        }
        setLoad({ type: "ok", text: new TextDecoder("utf-8", { fatal: false }).decode(bytes) });
      })
      .catch((e: unknown) => { if (!cancelled) setLoad({ type: "error", message: String(e) }); });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [filePath]);

  useEffect(() => {
    if (load.type !== "image") return;
    return () => URL.revokeObjectURL(load.blobUrl);
  }, [load]);

  const ext = filePath?.split(".").pop()?.toLowerCase() ?? "";
  const lang = filePath ? guessLang(filePath) : undefined;
  const name = filePath ? basename(filePath) : "";
  const dual = filePath ? supportsDualView(filePath) : false;
  const isImage = load.type === "image";

  return (
    <aside className="w-[380px] flex-shrink-0 flex-grow-0 flex flex-col min-h-0 mt-[6px] mr-2 mb-2 rounded-xl bg-bg-muted shadow-[0_2px_16px_-4px_hsl(var(--accent)/0.12),0_0_0_1px_hsl(var(--border)/0.6)] overflow-hidden" style={{ minWidth: "380px", maxWidth: "380px" }}>
      {/* Header */}
      <div className="h-[32px] border-b border-border/50 flex items-center gap-2 px-3 select-none flex-shrink-0">
        {/* File type icon */}
        {isImage ? (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-fg-subtle flex-shrink-0">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <circle cx="5.5" cy="6" r="1" />
            <path d="M1.5 11l3.5-3.5 3 3 2-2 3.5 3.5" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-fg-subtle flex-shrink-0">
            <path d="M3 2h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
            <path d="M10 2v4h4" />
          </svg>
        )}

        {/* Filename only */}
        <span className="flex-1 min-w-0 text-[12px] font-medium text-fg truncate" title={filePath ?? ""}>
          {name || "No file selected"}
        </span>

        {/* source <-> preview toggle — icon buttons only */}
        {dual && load.type === "ok" && (
          <div className="flex items-center rounded-full border border-border/60 bg-bg/60 p-0.5 gap-0 flex-shrink-0">
            <button
              onClick={() => setViewMode("source")}
              title="Source"
              aria-label="Source view"
              className={`flex items-center justify-center w-6 h-5 rounded-full transition-colors duration-150 ${
                viewMode === "source" ? "bg-bg-muted text-fg shadow-sm" : "text-fg-subtle/60 hover:text-fg-subtle"
              }`}
            >
              <SourceIcon />
            </button>
            <button
              onClick={() => setViewMode("preview")}
              title="Preview"
              aria-label="Preview"
              className={`flex items-center justify-center w-6 h-5 rounded-full transition-colors duration-150 ${
                viewMode === "preview" ? "bg-bg-muted text-fg shadow-sm" : "text-fg-subtle/60 hover:text-fg-subtle"
              }`}
            >
              <PreviewIcon />
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 p-3">
        {load.type === "idle" && (
          <div className="flex flex-col items-center justify-center h-24 text-fg-subtle text-xs gap-1">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
              <path d="M3 2h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
              <path d="M10 2v4h4" />
            </svg>
            <span className="opacity-50">No file open</span>
          </div>
        )}
        {load.type === "loading" && (
          <div className="flex items-center justify-center h-24 gap-2 text-fg-subtle text-xs">
            <svg width="14" height="14" viewBox="0 0 16 16" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="8" cy="8" r="6" strokeOpacity="0.3" />
              <path d="M8 2a6 6 0 0 1 6 6" strokeLinecap="round" />
            </svg>
            Loading…
          </div>
        )}
        {load.type === "error" && (
          <div className="rounded-lg border border-status-error/25 bg-status-error/8 px-3 py-2.5 text-xs text-status-error">
            {load.message}
          </div>
        )}
        {load.type === "binary" && (
          <div className="flex flex-col items-center justify-center h-24 text-fg-subtle text-xs gap-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            <span>Binary file — preview not available</span>
          </div>
        )}
        {load.type === "image" && (
          <div className="flex items-center justify-center">
            <img src={load.blobUrl} alt={name} className="max-w-full object-contain rounded-md select-none" draggable={false} />
          </div>
        )}
        {load.type === "ok" && (
          <>
            {viewMode === "source" || !dual ? (
              <div className="[&_.shiki-wrap>pre]:!text-[11px] [&_.shiki-wrap>pre]:!leading-relaxed [&_pre]:!text-[11px] [&_pre]:!leading-relaxed">
                <CodeBlock lang={lang} code={load.text} />
              </div>
            ) : (
              <>
                {(ext === "md" || ext === "markdown") && <MarkdownPreview text={load.text} />}
                {(ext === "html" || ext === "htm") && <HtmlPreview text={load.text} />}
                {ext === "svg" && <SvgPreview text={load.text} />}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
