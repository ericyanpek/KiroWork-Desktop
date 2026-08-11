import type { AcpStatusEvent } from "../types/acp";

export const RECONNECT_DELAYS_MS = [0, 2_000, 5_000] as const;

export function shouldAutoReconnect(event: AcpStatusEvent): boolean {
  return event.status === "disconnected" && event.recoverable;
}

export async function retryWithDelays<T>(
  operation: (attempt: number) => Promise<T>,
  delays: readonly number[] = RECONNECT_DELAYS_MS,
  sleep: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise((resolve) => setTimeout(resolve, delayMs)),
): Promise<T> {
  if (delays.length === 0) {
    throw new Error("reconnect policy must include at least one attempt");
  }

  let lastError: unknown;
  for (let index = 0; index < delays.length; index += 1) {
    const delay = delays[index];
    if (delay > 0) await sleep(delay);
    try {
      return await operation(index + 1);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
