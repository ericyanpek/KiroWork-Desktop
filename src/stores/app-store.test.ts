import { describe, expect, it } from "vitest";
import { replayToMessages } from "./app-store";

describe("replayToMessages", () => {
  it("rebuilds user, assistant, and completed tool call messages", () => {
    expect(
      replayToMessages([
        { role: "user", id: "u1", text: "Inspect this project" },
        {
          role: "agent",
          id: "a1",
          blocks: [
            { kind: "text", text: "I will inspect it." },
            {
              kind: "toolUse",
              toolUseId: "tool-1",
              name: "read",
              input: { path: "README.md" },
            },
          ],
        },
        {
          role: "tool",
          id: "t1",
          toolUseId: "tool-1",
          text: "contents",
        },
      ]),
    ).toEqual([
      { id: "u1", role: "user", text: "Inspect this project" },
      {
        id: "a1",
        role: "assistant",
        text: "I will inspect it.",
        streaming: false,
        toolCalls: [
          {
            toolCallId: "tool-1",
            title: "read",
            kind: "read",
            status: "completed",
          },
        ],
      },
    ]);
  });
});
