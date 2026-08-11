import { useMemo, useState } from "react";
import { respondPermission } from "../lib/tauri-bridge";
import { useApp } from "../stores/app-store";
import type { AppError } from "../types/acp";

export function PermissionPrompt() {
  const request = useApp((state) => state.pendingPermissions[0] ?? null);
  const removePermission = useApp((state) => state.removePermission);
  const setError = useApp((state) => state.setError);
  const [busy, setBusy] = useState(false);

  const choices = useMemo(() => {
    const options = request?.options ?? [];
    return {
      once: options.find((option) => option.kind === "allow_once"),
      always: options.find((option) => option.kind === "allow_always"),
      reject:
        options.find((option) => option.kind === "reject_once") ??
        options.find((option) => option.kind === "reject_always"),
    };
  }, [request]);

  if (!request) return null;

  async function decide(optionId: string | null) {
    if (!request || busy) return;
    setBusy(true);
    try {
      await respondPermission(request.requestId, optionId);
      removePermission(request.requestId);
    } catch (error) {
      setError(error as AppError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-title"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-elevated p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-status-warning/15 text-status-warning">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="permission-title" className="text-sm font-semibold text-fg">
              Allow tool access?
            </h2>
            <p className="mt-1 break-words text-[13px] leading-relaxed text-fg-muted">
              {request.title}
            </p>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-fg-subtle">
              <span className="badge badge-warning">{request.kind}</span>
              {request.toolCallId && (
                <span className="truncate font-mono" title={request.toolCallId}>
                  {request.toolCallId}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(choices.reject?.optionId ?? null)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-status-error/50 hover:bg-status-error/8 hover:text-status-error disabled:opacity-50"
          >
            Reject
          </button>
          {choices.always && (
            <button
              type="button"
              disabled={busy}
              onClick={() => decide(choices.always!.optionId)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-accent/50 hover:bg-accent/8 hover:text-fg disabled:opacity-50"
            >
              Always allow
            </button>
          )}
          {choices.once && (
            <button
              type="button"
              disabled={busy}
              onClick={() => decide(choices.once!.optionId)}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent-strong disabled:opacity-50"
            >
              Allow once
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
