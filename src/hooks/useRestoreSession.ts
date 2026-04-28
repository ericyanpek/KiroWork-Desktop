import { useCallback } from "react";
import { loadSession, listPersistedSessions } from "../lib/tauri-bridge";
import { replayToMessages, useApp } from "../stores/app-store";
import type { AppError, SessionMeta } from "../types/acp";

/** Load the list of persisted sessions into the store. Silently swallows
 *  errors (sidebar just shows nothing) — this is a background concern. */
export function useLoadPersistedSessions() {
  const setPersistedSessions = useApp((s) => s.setPersistedSessions);
  return useCallback(async () => {
    try {
      const list = await listPersistedSessions();
      setPersistedSessions(list);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.debug("[sessions] list failed", e);
    }
  }, [setPersistedSessions]);
}

/** Restore a persisted session: tell kiro-cli via session/load, then read
 *  local jsonl and repopulate the message timeline. Never calls startTurn
 *  or invokes ACP prompt — replay is a pure client-side reconstruction. */
export function useRestoreSession() {
  const resetSession = useApp((s) => s.resetSession);
  const hydrateFromSessionResult = useApp((s) => s.hydrateFromSessionResult);
  const setSession = useApp((s) => s.setSession);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const setMessages = useApp((s) => s.setMessages);
  const setError = useApp((s) => s.setError);

  return useCallback(
    async (meta: SessionMeta) => {
      resetSession();
      try {
        const res = await loadSession(meta.sessionId, meta.cwd);
        hydrateFromSessionResult(res.session);
        setSession(meta.sessionId);
        setWorkspace(meta.cwd);
        setMessages(replayToMessages(res.replay));
      } catch (e) {
        setError(e as AppError);
        throw e;
      }
    },
    [
      resetSession,
      hydrateFromSessionResult,
      setSession,
      setWorkspace,
      setMessages,
      setError,
    ],
  );
}
