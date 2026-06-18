import { describe, expect, it } from "vitest";
import type { DynamicToolUIPart } from "ai";
import { normalizeToolPart } from "@repo/shared";

function part(over: {
  toolName: string;
  input?: unknown;
  output?: unknown;
  state?: DynamicToolUIPart["state"];
  toolCallId?: string;
}): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolName: over.toolName,
    toolCallId: over.toolCallId ?? "call-1",
    state: over.state ?? "output-available",
    input: over.input,
    output: over.output,
  } as unknown as DynamicToolUIPart;
}

describe("codexToolNormalizer", () => {
  it("exec maps to bash", () => {
    const result = normalizeToolPart(
      part({
        toolName: "exec",
        input: { type: "commandExecution", command: "ls" },
        output: { aggregatedOutput: "file.txt", exitCode: 0 },
      }),
      "openai-codex",
    );
    expect(result[0]!.kind).toBe("bash");
    if (result[0]!.kind === "bash") {
      expect(result[0]!.payload.command).toBe("ls");
      expect(result[0]!.payload.output).toBe("file.txt");
      expect(result[0]!.payload.exitCode).toBe(0);
    }
  });

  it("patch update maps to edit with provided diff", () => {
    const result = normalizeToolPart(
      part({
        toolName: "patch",
        input: {
          type: "fileChange",
          changes: [{ path: "/x.ts", kind: { type: "update" }, diff: "@@ ..." }],
        },
      }),
      "openai-codex",
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("edit");
    if (result[0]!.kind === "edit") {
      expect(result[0]!.payload.diff).toBe("@@ ...");
      expect(result[0]!.payload.path).toBe("/x.ts");
    }
  });

  it("patch add maps to write isNew", () => {
    const result = normalizeToolPart(
      part({
        toolName: "patch",
        input: {
          type: "fileChange",
          changes: [{ path: "/n.ts", kind: { type: "add" }, content: "hello" }],
        },
      }),
      "openai-codex",
    );
    expect(result[0]!.kind).toBe("write");
    if (result[0]!.kind === "write") {
      expect(result[0]!.payload.isNew).toBe(true);
      expect(result[0]!.payload.content).toBe("hello");
    }
  });

  it("patch delete maps to write deleted", () => {
    const result = normalizeToolPart(
      part({
        toolName: "patch",
        input: {
          type: "fileChange",
          changes: [{ path: "/old.ts", kind: { type: "delete" } }],
        },
      }),
      "openai-codex",
    );
    expect(result[0]!.kind).toBe("write");
    if (result[0]!.kind === "write") {
      expect(result[0]!.payload.deleted).toBe(true);
    }
  });

  it("patch with mixed changes fans out", () => {
    const result = normalizeToolPart(
      part({
        toolName: "patch",
        input: {
          type: "fileChange",
          changes: [
            { path: "/a.ts", kind: { type: "update" }, diff: "d1" },
            { path: "/b.ts", kind: { type: "add" }, content: "x" },
          ],
        },
      }),
      "openai-codex",
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.kind).toBe("edit");
    expect(result[1]!.kind).toBe("write");
  });

  it("update_plan maps to todo", () => {
    const result = normalizeToolPart(
      part({ toolName: "update_plan", input: { plan: [] } }),
      "openai-codex",
    );
    expect(result[0]!.kind).toBe("todo");
  });

  it("web_search maps to web search from output action query", () => {
    const result = normalizeToolPart(
      part({
        toolName: "web_search",
        input: { type: "webSearch", query: "" },
        output: {
          action: {
            type: "search",
            query: "Microsoft Teams bot outgoing webhook",
            queries: ["Microsoft Teams bot outgoing webhook"],
          },
        },
      }),
      "openai-codex",
    );

    expect(result[0]!.kind).toBe("web");
    if (result[0]!.kind === "web") {
      expect(result[0]!.payload.kind).toBe("search");
      expect(result[0]!.payload.query).toBe("Microsoft Teams bot outgoing webhook");
    }
  });

  it("unknown falls back to other", () => {
    const result = normalizeToolPart(
      part({ toolName: "weird_tool", input: {} }),
      "openai-codex",
    );
    expect(result[0]!.kind).toBe("other");
  });
});
