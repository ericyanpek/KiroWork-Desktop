import { describe, expect, it, vi } from "vitest";
import { retryWithDelays, shouldAutoReconnect } from "./reconnect";

describe("retryWithDelays", () => {
  it("retries with the configured delays and returns the first success", async () => {
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockResolvedValue("connected");
    const sleep = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue();

    await expect(
      retryWithDelays(operation, [0, 20, 50], sleep),
    ).resolves.toBe("connected");
    expect(operation.mock.calls).toEqual([[1], [2], [3]]);
    expect(sleep.mock.calls).toEqual([[20], [50]]);
  });

  it("returns the final error after all attempts fail", async () => {
    const finalError = new Error("still offline");
    const operation = vi
      .fn<(attempt: number) => Promise<never>>()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValue(finalError);

    await expect(
      retryWithDelays(operation, [0, 0]),
    ).rejects.toBe(finalError);
  });
});

describe("shouldAutoReconnect", () => {
  it("only retries unexpected disconnects", () => {
    expect(
      shouldAutoReconnect({ status: "disconnected", recoverable: true }),
    ).toBe(true);
    expect(
      shouldAutoReconnect({ status: "disconnected", recoverable: false }),
    ).toBe(false);
    expect(
      shouldAutoReconnect({ status: "reconnect_failed", recoverable: true }),
    ).toBe(false);
  });
});
