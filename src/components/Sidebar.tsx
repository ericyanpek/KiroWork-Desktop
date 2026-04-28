import { useEffect, useState } from "react";
import { useApp } from "../stores/app-store";
import { useLocalStorageBoolean } from "../hooks/useLocalStorage";
import {
  useLoadPersistedSessions,
  useRestoreSession,
} from "../hooks/useRestoreSession";
import { useWorkspaceScan } from "../hooks/useWorkspaceScan";
import { CollapsibleSection } from "./CollapsibleSection";
import { KiroMark } from "./KiroMark";
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

function inclusionBadge(inclusion: string): {
  label: string;
  className: string;
} {
  switch (inclusion) {
    case "always":
      return { label: "always", className: "bg-accent/20 text-accent-strong" };
    case "fileMatch":
      return {
        label: "file",
        className: "bg-blue-500/15 text-blue-400",
      };
    case "auto":
      return { label: "auto", className: "bg-green-500/15 text-green-400" };
    case "manual":
      return { label: "manual", className: "bg-bg-muted text-fg-subtle" };
    default:
      return { label: inclusion, className: "bg-bg-muted text-fg-subtle" };
  }
}

function SessionRow({
  session,
  active,
  onPick,
  loading,
}: {
  session: SessionMeta;
  active: boolean;
  loading: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onPick}
        disabled={loading}
        className={`w-full text-left px-3 py-2 border-l-2 transition-colors ${
          active
            ? "border-accent bg-accent/10"
            : "border-transparent hover:bg-bg-muted/60"
        }`}
      >
        <div className="text-xs font-medium text-fg truncate">
          {session.title || "(untitled)"}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-fg-subtle">
          <span>{relativeTime(session.updatedAt)}</span>
          {session.cwd && (
            <>
              <span>·</span>
              <span className="truncate" title={session.cwd}>
                {basename(session.cwd)}
              </span>
            </>
          )}
        </div>
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
        <span
          className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>
      {entry.fileMatchPattern && (
        <div className="text-[10px] text-fg-subtle font-mono mt-0.5 truncate">
          {entry.fileMatchPattern}
        </div>
      )}
    </li>
  );
}

export function Sidebar() {
  const sessions = useApp((s) => s.persistedSessions);
  const currentSessionId = useApp((s) => s.sessionId);
  const manifest = useApp((s) => s.workspaceManifest);
  const loadList = useLoadPersistedSessions();
  const restore = useRestoreSession();
  const refreshScan = useWorkspaceScan();
  const [loading, setLoading] = useState<string | null>(null);
  const [showKiroConfig, , toggleKiroConfig] = useLocalStorageBoolean(
    "kirowork.sidebar.showKiroConfig",
    true,
  );

  useEffect(() => {
    loadList();
  }, [loadList]);

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

  async function handleRefresh() {
    await Promise.all([loadList(), refreshScan()]);
  }

  const skills = manifest?.skills ?? [];
  const mcp = manifest?.mcpServers ?? [];
  const steering = manifest?.steering ?? [];

  return (
    <aside className="w-[260px] flex-shrink-0 border-r border-border bg-bg-muted/40 flex flex-col min-h-0">
      <div className="px-3 py-3 border-b border-border flex items-center justify-between">
        <KiroMark size="sm" />
        <div className="flex items-center gap-1">
          <button
            onClick={toggleKiroConfig}
            title={showKiroConfig ? "Hide .kiro/ panels" : "Show .kiro/ panels"}
            aria-pressed={showKiroConfig}
            aria-label={showKiroConfig ? "Hide .kiro/ panels" : "Show .kiro/ panels"}
            className={`p-1 transition-colors ${
              showKiroConfig ? "text-fg-muted hover:text-fg" : "text-fg-subtle hover:text-fg"
            }`}
          >
            {showKiroConfig ? (
              // eye-open
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
                <circle cx="8" cy="8" r="2" />
              </svg>
            ) : (
              // eye-off
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3l10 10" />
                <path d="M6.5 4.2A7.6 7.6 0 0 1 8 4c4.5 0 7 4 7 4a13 13 0 0 1-2.1 2.6M10.8 10.8A7.6 7.6 0 0 1 8 12c-4.5 0-7-4-7-4a13 13 0 0 1 3-3.4" />
                <path d="M6.6 6.6a2 2 0 0 0 2.8 2.8" />
              </svg>
            )}
          </button>
          <button
            onClick={handleRefresh}
            title="Refresh"
            className="text-fg-subtle hover:text-fg transition-colors p-1"
            aria-label="Refresh sidebar"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 8A6 6 0 1 1 8 2V4L11 7" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <CollapsibleSection title="Sessions" count={sessions.length} defaultOpen>
          {sessions.length === 0 ? (
            <p className="px-3 py-2 text-xs text-fg-subtle italic">
              No persisted sessions yet.
            </p>
          ) : (
            <ul className="flex flex-col">
              {sessions.map((s) => (
                <SessionRow
                  key={s.sessionId}
                  session={s}
                  active={s.sessionId === currentSessionId}
                  loading={loading === s.sessionId}
                  onPick={() => handlePick(s)}
                />
              ))}
            </ul>
          )}
        </CollapsibleSection>

        {showKiroConfig && (
          <>
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
          </>
        )}
      </div>
    </aside>
  );
}
