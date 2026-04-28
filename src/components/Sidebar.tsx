import { useEffect, useState } from "react";
import { useApp } from "../stores/app-store";
import {
  useLoadPersistedSessions,
  useRestoreSession,
} from "../hooks/useRestoreSession";
import { CollapsibleSection } from "./CollapsibleSection";
import { KiroMark } from "./KiroMark";
import type { SessionMeta } from "../types/acp";

function basename(p: string): string {
  if (!p) return "";
  const trimmed = p.endsWith("/") ? p.slice(0, -1) : p;
  const i = trimmed.lastIndexOf("/");
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

function relativeTime(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const delta = (Date.now() - t) / 1000;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

export function Sidebar() {
  const sessions = useApp((s) => s.persistedSessions);
  const currentSessionId = useApp((s) => s.sessionId);
  const loadList = useLoadPersistedSessions();
  const restore = useRestoreSession();
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // Refresh the list whenever the active session changes (covers new
  // sessions created via Open Folder as well as restored ones).
  useEffect(() => {
    if (currentSessionId) loadList();
  }, [currentSessionId, loadList]);

  async function handlePick(meta: SessionMeta) {
    if (meta.sessionId === currentSessionId) return;
    setLoading(meta.sessionId);
    try {
      await restore(meta);
    } catch {
      /* error already in store */
    } finally {
      setLoading(null);
    }
  }

  return (
    <aside className="w-[260px] flex-shrink-0 border-r border-border bg-bg-muted/40 flex flex-col min-h-0">
      <div className="px-3 py-3 border-b border-border flex items-center justify-between">
        <KiroMark size="sm" />
        <button
          onClick={loadList}
          title="Refresh"
          className="text-fg-subtle hover:text-fg transition-colors p-1"
          aria-label="Refresh sessions"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 8A6 6 0 1 1 8 2V4L11 7" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <CollapsibleSection title="Sessions" count={sessions.length} defaultOpen>
          {sessions.length === 0 ? (
            <p className="px-3 py-2 text-xs text-fg-subtle italic">No persisted sessions yet.</p>
          ) : (
            <ul className="flex flex-col">
              {sessions.map((s) => {
                const active = s.sessionId === currentSessionId;
                const isLoading = loading === s.sessionId;
                return (
                  <li key={s.sessionId}>
                    <button
                      onClick={() => handlePick(s)}
                      disabled={isLoading}
                      className={`w-full text-left px-3 py-2 border-l-2 transition-colors ${
                        active
                          ? "border-accent bg-accent/10"
                          : "border-transparent hover:bg-bg-muted/60"
                      }`}
                    >
                      <div className="text-xs font-medium text-fg truncate">
                        {s.title || "(untitled)"}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-fg-subtle">
                        <span>{relativeTime(s.updatedAt)}</span>
                        {s.cwd && (
                          <>
                            <span>·</span>
                            <span className="truncate" title={s.cwd}>{basename(s.cwd)}</span>
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CollapsibleSection>
      </div>
    </aside>
  );
}
