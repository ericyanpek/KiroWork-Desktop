import { useMemo, useState } from "react";
import { diffLines } from "diff";
import type { ToolCallView } from "../stores/app-store";
import type { ToolCallContent } from "../types/acp";

function basename(p: string): string {
  if (!p) return "";
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function statusDot(status: string) {
  const color =
    status === "completed"
      ? "hsl(149 65% 52%)"
      : status === "failed"
        ? "hsl(353 94% 62%)"
        : "hsl(50 86% 57%)";
  const glow = status === "completed" || status === "failed"
    ? undefined
    : "0 0 8px hsl(50 86% 57% / 0.6)";
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ backgroundColor: color, boxShadow: glow }}
    />
  );
}

type DiffChunk = { type: "diff"; path: string; oldText: string; newText: string };

function isDiffChunk(c: ToolCallContent): c is DiffChunk {
  if (c.type !== "diff") return false;
  // The union's fallback branch widens fields to unknown; validate at
  // runtime before trusting them.
  const r = c as Record<string, unknown>;
  return typeof r.path === "string" && typeof r.oldText === "string" && typeof r.newText === "string";
}

/** Render one before/after pair as a unified diff block. */
function DiffBlock({ chunk, initiallyExpanded }: { chunk: DiffChunk; initiallyExpanded: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);

  const parts = useMemo(
    () => diffLines(chunk.oldText ?? "", chunk.newText ?? ""),
    [chunk.oldText, chunk.newText],
  );

  // Flatten into individual diff lines with kind tags.
  type Line = { kind: "add" | "del" | "ctx"; text: string };
  const allLines: Line[] = [];
  for (const p of parts) {
    const kind: Line["kind"] = p.added ? "add" : p.removed ? "del" : "ctx";
    const lines = p.value.split("\n");
    // diff.js appends a trailing empty string when the chunk ends in \n.
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    for (const text of lines) allLines.push({ kind, text });
  }

  const preview = 20;
  const visible = expanded ? allLines : allLines.slice(0, preview);
  const hiddenCount = allLines.length - visible.length;

  return (
    <div className="border border-border rounded-md overflow-hidden bg-bg-muted/40">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-fg-subtle border-b border-border bg-bg-muted/60">
        <span className="font-mono text-fg-muted truncate" title={chunk.path}>
          {basename(chunk.path)}
        </span>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">
          diff
        </span>
      </div>
      <pre className="text-[11px] leading-5 font-mono overflow-x-auto p-0 m-0">
        {visible.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === "add"
                ? "bg-green-500/10 text-green-400 pl-3 pr-2"
                : l.kind === "del"
                  ? "bg-red-500/10 text-red-400 pl-3 pr-2"
                  : "text-fg-subtle pl-3 pr-2"
            }
          >
            <span className="opacity-60 mr-2 select-none">
              {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
            </span>
            {l.text || " "}
          </div>
        ))}
      </pre>
      {hiddenCount > 0 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-3 py-1 text-[11px] text-fg-subtle hover:text-fg bg-bg-muted/60 border-t border-border transition-colors"
        >
          Show {hiddenCount} more line{hiddenCount === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

export function ToolCallCard({ call }: { call: ToolCallView }) {
  const content = (call.content ?? []) as ToolCallContent[];
  const diffs = content.filter(isDiffChunk);
  const isEditWithDiff = call.kind === "edit" && diffs.length > 0;

  if (isEditWithDiff) {
    return (
      <div className="w-full max-w-3xl flex flex-col gap-1.5 px-1">
        <div className="text-xs text-fg-subtle font-mono flex items-center gap-2">
          {statusDot(call.status)}
          <span className="opacity-70">Edit</span>
          <span className="text-fg-muted">{call.title || call.kind}</span>
          <span className="text-fg-subtle">({call.status})</span>
        </div>
        <div className="flex flex-col gap-2">
          {diffs.map((d, i) => (
            <DiffBlock key={i} chunk={d} initiallyExpanded={diffs.length === 1} />
          ))}
        </div>
      </div>
    );
  }

  // Fallback: Phase 1 style one-liner.
  return (
    <div className="text-xs text-fg-subtle font-mono flex items-center gap-2">
      {statusDot(call.status)}
      <span className="opacity-70">Tool</span>
      <span className="text-fg-muted">{call.title || call.kind}</span>
      <span className="text-fg-subtle">({call.status})</span>
    </div>
  );
}
