import type { SlashCommand, SubagentView } from "../types/acp";

export function normalizeCommands(payload: unknown): SlashCommand[] {
  const object =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  const raw = Array.isArray(payload)
    ? payload
    : object?.commands ?? object?.availableCommands ?? [];
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (typeof entry === "string") {
      return [{ name: entry.replace(/^\//, ""), description: "" }];
    }
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const name = String(item.name ?? item.command ?? "").replace(/^\//, "");
    if (!name) return [];
    return [
      {
        name,
        description: String(item.description ?? item.help ?? ""),
        inputHint: item.inputHint ? String(item.inputHint) : undefined,
      },
    ];
  });
}

export function normalizeSubagents(payload: unknown): SubagentView[] {
  const object =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  const raw = Array.isArray(payload) ? payload : object?.subagents ?? [];
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const id = String(item.sessionId ?? item.id ?? "");
    if (!id) return [];
    const rawStatus = item.status;
    const status =
      typeof rawStatus === "string"
        ? rawStatus
        : rawStatus && typeof rawStatus === "object"
          ? String((rawStatus as Record<string, unknown>).type ?? "working")
          : "working";
    return [
      {
        id,
        role: String(item.role ?? item.name ?? item.agentName ?? "subagent"),
        status,
        title: item.title ? String(item.title) : undefined,
      },
    ];
  });
}
