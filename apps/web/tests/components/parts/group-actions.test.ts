import { describe, expect, it } from "vitest";
import type { NormalizedToolAction } from "@repo/shared";
import { groupActions } from "@/components/parts/group-actions";

function read(callId: string, path: string): NormalizedToolAction {
  return {
    kind: "read",
    toolName: "Read",
    toolCallId: callId,
    state: "output-available",
    payload: { paths: [path] },
  };
}

function bash(callId: string, command: string): NormalizedToolAction {
  return {
    kind: "bash",
    toolName: "Bash",
    toolCallId: callId,
    state: "output-available",
    payload: { command },
  };
}

function edit(callId: string, path: string): NormalizedToolAction {
  return {
    kind: "edit",
    toolName: "Edit",
    toolCallId: callId,
    state: "output-available",
    payload: { path, diff: "" },
  };
}

describe("groupActions", () => {
  it("groups three consecutive reads", () => {
    const result = groupActions([
      read("c1", "/a"),
      read("c2", "/b"),
      read("c3", "/c"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("group");
    if (result[0]!.type === "group") {
      expect(result[0]!.actions).toHaveLength(3);
      expect(result[0]!.kind).toBe("read");
    }
  });

  it("does not group non-adjacent reads", () => {
    const result = groupActions([
      read("c1", "/a"),
      bash("c2", "ls"),
      read("c3", "/b"),
    ]);
    expect(result).toHaveLength(3);
    expect(result.every((item) => item.type === "single")).toBe(true);
  });

  it("never groups edits", () => {
    const result = groupActions([
      edit("c1", "/a"),
      edit("c2", "/b"),
    ]);
    expect(result).toHaveLength(2);
    expect(result.every((item) => item.type === "single")).toBe(true);
  });

  it("group key is stable on the first toolCallId", () => {
    const a = groupActions([read("c1", "/a"), read("c2", "/b")]);
    const b = groupActions([read("c1", "/a"), read("c2", "/b"), read("c3", "/c")]);
    expect(a[0]!.key).toBe(b[0]!.key);
  });

  it("a singleton groupable action is unwrapped to a single", () => {
    const result = groupActions([read("c1", "/a"), bash("c2", "ls")]);
    expect(result[0]!.type).toBe("single");
  });
});
