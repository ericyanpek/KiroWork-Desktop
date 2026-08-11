import { describe, expect, it } from "vitest";
import { normalizeCommands, normalizeSubagents } from "./acp-normalizers";

describe("normalizeCommands", () => {
  it("accepts string and object command shapes", () => {
    expect(
      normalizeCommands({
        availableCommands: [
          "/help",
          {
            command: "/effort",
            help: "Set reasoning effort",
            inputHint: "low|high",
          },
        ],
      }),
    ).toEqual([
      { name: "help", description: "" },
      {
        name: "effort",
        description: "Set reasoning effort",
        inputHint: "low|high",
      },
    ]);
  });

  it("drops malformed entries", () => {
    expect(normalizeCommands({ commands: [null, {}, 42] })).toEqual([]);
  });
});

describe("normalizeSubagents", () => {
  it("normalizes nested status and alternate identity fields", () => {
    expect(
      normalizeSubagents({
        subagents: [
          {
            sessionId: "sub-1",
            agentName: "reviewer",
            status: { type: "working" },
            title: "Review changes",
          },
        ],
      }),
    ).toEqual([
      {
        id: "sub-1",
        role: "reviewer",
        status: "working",
        title: "Review changes",
      },
    ]);
  });
});
