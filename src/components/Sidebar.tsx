import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { deleteSession } from "../lib/tauri-bridge";
import { useApp } from "../stores/app-store";
import {
  useLoadPersistedSessions,
  useRestoreSession,
} from "../hooks/useRestoreSession";
import { useWorkspaceScan } from "../hooks/useWorkspaceScan";
import { CollapsibleSection } from "./CollapsibleSection";
import type {
  McpServerEntry,
  SessionMeta,
  SkillEntry,
  SteeringEntry,
} from "../types/acp";

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

function inclusionBadge(inclusion: string): { label: string; cls: string } {
  switch (inclusion) {
    case "always":    return { label: "always",    cls: "badge badge-accent" };
    case "fileMatch": return { label: "file",      cls: "badge badge-info" };
    case "auto":      return { label: "auto",      cls: "badge badge-success" };
    case "manual":    return { label: "manual",    cls: "badge badge-default" };
    default:          return { label: inclusion,   cls: "badge badge-default" };
  }
}

function SessionRow({
  session,
  active,
  onPick,
  loading,
  onDelete,
}: {
  session: SessionMeta;
  active: boolean;
  loading: boolean;
  onPick: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group relative">
      <button
        onClick={onPick}
        disabled={loading}
        className={`w-full text-left px-3 py-2.5 border-l-2 transition-colors duration-150 pr-8 ${
          active
            ? "border-accent bg-accent/10"
            : "border-transparent hover:bg-bg-muted/50"
        }`}
      >
        <div className={`text-[13px] font-medium truncate leading-snug ${active ? "text-fg" : "text-fg-muted"}`}>
          {session.title || "(untitled)"}
        </div>
        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-fg-subtle">
          <span className="tabular-nums">{relativeTime(session.updatedAt)}</span>
          {session.cwd && (
            <>
              <span className="opacity-40">·</span>
              <span className="truncate font-mono text-[10px]" title={session.cwd}>
                {basename(session.cwd)}
              </span>
            </>
          )}
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Delete session"
        aria-label="Delete session"
        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-1 rounded text-fg-subtle hover:text-status-error hover:bg-status-error/10"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" />
        </svg>
      </button>
    </li>
  );
}

function SkillRow({ skill }: { skill: SkillEntry }) {
  return (
    <li className="px-3 py-1.5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-xs font-medium text-fg truncate">{skill.name}</span>
        {skill.version && (
          <span className="text-[10px] text-fg-subtle font-mono">
            v{skill.version}
          </span>
        )}
      </div>
      {skill.description && (
        <div className="text-[11px] text-fg-subtle line-clamp-2 mt-0.5">
          {skill.description}
        </div>
      )}
    </li>
  );
}

function McpRow({ server }: { server: McpServerEntry }) {
  return (
    <li className={`px-3 py-1.5 ${server.disabled ? "opacity-50" : ""}`}>
      <div className="text-xs font-medium text-fg truncate">{server.name}</div>
      <div className="text-[11px] text-fg-subtle font-mono truncate">
        {server.command}
        {server.args.length > 0 && ` ${server.args[0]}`}
        {server.disabled && " (disabled)"}
      </div>
    </li>
  );
}

function SteeringRow({ entry }: { entry: SteeringEntry }) {
  const badge = inclusionBadge(entry.inclusion);
  return (
    <li className="px-3 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-fg truncate">
          {entry.name}
        </span>
        <span className={badge.cls}>{badge.label}</span>
      </div>
      {entry.fileMatchPattern && (
        <div className="text-[10px] text-fg-subtle font-mono mt-0.5 truncate">
          {entry.fileMatchPattern}
        </div>
      )}
    </li>
  );
}

export function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const sessions = useApp((s) => s.persistedSessions);
  const currentSessionId = useApp((s) => s.sessionId);
  const removePersistedSession = useApp((s) => s.removePersistedSession);
  const manifest = useApp((s) => s.workspaceManifest);
  const loadList = useLoadPersistedSessions();
  const restore = useRestoreSession();
  useWorkspaceScan();
  const [loading, setLoading] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (currentSessionId) loadList();
  }, [currentSessionId, loadList]);

  async function handleDelete(meta: SessionMeta) {
    try {
      await deleteSession(meta.sessionId);
      removePersistedSession(meta.sessionId);
    } catch {
      /* silently ignore — file may already be gone */
    }
  }

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

  const skills = manifest?.skills ?? [];
  const mcp = manifest?.mcpServers ?? [];
  const steering = manifest?.steering ?? [];

  const filteredSessions = search.trim()
    ? sessions.filter((s) =>
        (s.title ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (s.cwd ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : sessions;

  return (
    <aside className="w-[260px] flex-shrink-0 flex flex-col min-h-0 mt-[6px] mx-2 mb-2 rounded-xl bg-bg-muted shadow-[0_2px_16px_-4px_hsl(var(--accent)/0.12),0_0_0_1px_hsl(var(--border)/0.6)] overflow-hidden">
      <div
        data-tauri-drag-region
        className="pl-[80px] pr-3 h-[32px] border-b border-border/50 flex items-center justify-end select-none"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          getCurrentWindow().startDragging();
        }}
      >
        <button
          onClick={onCollapse}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="flex items-center justify-center w-7 h-6 rounded-full border border-border/60 bg-bg/60 text-fg-subtle hover:text-fg hover:border-accent/40 hover:bg-bg-muted/60 transition-colors duration-150"
        >
          {/* panel-left icon: left stripe + left-pointing chevron */}
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <path d="M6 3v10" />
            <path d="M9.5 6L7.5 8L9.5 10" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <CollapsibleSection title="Sessions" count={sessions.length} defaultOpen>
          {sessions.length > 0 && (
            <div className="px-2 pb-1.5">
              <div className="relative">
                <svg className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle/50 pointer-events-none" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="6.5" cy="6.5" r="4.5" /><path d="M11 11l2.5 2.5" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search sessions…"
                  className="w-full pl-6 pr-2 py-1 text-[11px] bg-bg-muted/60 border border-border/60 rounded-md text-fg placeholder:text-fg-subtle/50 focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>
            </div>
          )}
          {filteredSessions.length === 0 ? (
            <p className="px-3 py-2 text-xs text-fg-subtle italic">
              {search ? "No matching sessions." : "No persisted sessions yet."}
            </p>
          ) : (
            <ul className="flex flex-col">
              {filteredSessions.map((s) => (
                <SessionRow
                  key={s.sessionId}
                  session={s}
                  active={s.sessionId === currentSessionId}
                  loading={loading === s.sessionId}
                  onPick={() => handlePick(s)}
                  onDelete={() => handleDelete(s)}
                />
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Skills" count={skills.length}>
          {skills.length === 0 ? (
            <p className="px-3 py-2 text-xs text-fg-subtle italic">
              No skills in .kiro/skills/
            </p>
          ) : (
            <ul>
              {skills.map((s) => (
                <SkillRow key={s.dirPath} skill={s} />
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="MCP Servers" count={mcp.length}>
          {mcp.length === 0 ? (
            <p className="px-3 py-2 text-xs text-fg-subtle italic">
              No .kiro/settings/mcp.json
            </p>
          ) : (
            <ul>
              {mcp.map((s) => (
                <McpRow key={s.name} server={s} />
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Steering" count={steering.length}>
          {steering.length === 0 ? (
            <p className="px-3 py-2 text-xs text-fg-subtle italic">
              No steering rules in .kiro/steering/
            </p>
          ) : (
            <ul>
              {steering.map((s) => (
                <SteeringRow key={s.filePath} entry={s} />
              ))}
            </ul>
          )}
        </CollapsibleSection>
      </div>
    </aside>
  );
}
