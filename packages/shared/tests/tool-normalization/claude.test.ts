import { describe, expect, it } from "vitest";
import type { DynamicToolUIPart } from "ai";
import { normalizeToolPart } from "@repo/shared";

function part(over: Partial<DynamicToolUIPart> & {
  toolName: string;
  input?: unknown;
  output?: unknown;
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

describe("claudeToolNormalizer", () => {
  it("Read maps to read with single path", () => {
    const result = normalizeToolPart(
      part({
        toolName: "Read",
        input: { file_path: "/x/y.ts", offset: 1, limit: 147 },
        output: "hello",
      }),
      "claude-code",
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("read");
    if (result[0]!.kind === "read") {
      expect(result[0]!.payload.paths).toEqual(["/x/y.ts"]);
      expect(result[0]!.payload.lineRange).toEqual({ start: 1, end: 147 });
      expect(result[0]!.payload.content).toBe("hello");
    }
  });

  it("Edit produces a diff", () => {
    const result = normalizeToolPart(
      part({
        toolName: "Edit",
        input: { file_path: "/x.ts", old_string: "foo", new_string: "bar" },
      }),
      "claude-code",
    );
    expect(result[0]!.kind).toBe("edit");
    if (result[0]!.kind === "edit") {
      expect(result[0]!.payload.path).toBe("/x.ts");
      expect(result[0]!.payload.diff).toContain("-foo");
      expect(result[0]!.payload.diff).toContain("+bar");
    }
  });

  it("MultiEdit fans out to multiple edits", () => {
    const result = normalizeToolPart(
      part({
        toolName: "MultiEdit",
        input: {
          file_path: "/x.ts",
          edits: [
            { old_string: "a", new_string: "b" },
            { old_string: "c", new_string: "d" },
          ],
        },
      }),
      "claude-code",
    );
    expect(result).toHaveLength(2);
    expect(result.every((action) => action.kind === "edit")).toBe(true);
  });

  it("Write maps to write with isNew", () => {
    const result = normalizeToolPart(
      part({ toolName: "Write", input: { file_path: "/x.ts", content: "hi" } }),
      "claude-code",
    );
    expect(result[0]!.kind).toBe("write");
    if (result[0]!.kind === "write") {
      expect(result[0]!.payload.isNew).toBe(true);
      expect(result[0]!.payload.content).toBe("hi");
    }
  });

  it("Bash maps to bash", () => {
    const result = normalizeToolPart(
      part({ toolName: "Bash", input: { command: "ls" }, output: "file.txt" }),
      "claude-code",
    );
    expect(result[0]!.kind).toBe("bash");
    if (result[0]!.kind === "bash") {
      expect(result[0]!.payload.command).toBe("ls");
      expect(result[0]!.payload.output).toBe("file.txt");
    }
  });

  it("Grep maps to search", () => {
    const result = normalizeToolPart(
      part({ toolName: "Grep", input: { pattern: "TODO" } }),
      "claude-code",
    );
    expect(result[0]!.kind).toBe("search");
  });

  it("Glob maps to search", () => {
    const result = normalizeToolPart(
      part({ toolName: "Glob", input: { pattern: "**/*.ts" } }),
      "claude-code",
    );
    expect(result[0]!.kind).toBe("search");
  });

  it("WebFetch maps to web fetch", () => {
    const result = normalizeToolPart(
      part({ toolName: "WebFetch", input: { url: "https://example.com" } }),
      "claude-code",
    );
    expect(result[0]!.kind).toBe("web");
    if (result[0]!.kind === "web") {
      expect(result[0]!.payload.kind).toBe("fetch");
    }
  });

  it("WebSearch maps to web search", () => {
    const result = normalizeToolPart(
      part({ toolName: "WebSearch", input: { query: "rust async" } }),
      "claude-code",
    );
    expect(result[0]!.kind).toBe("web");
    if (result[0]!.kind === "web") {
      expect(result[0]!.payload.kind).toBe("search");
    }
  });

  it("TodoWrite maps to todo", () => {
    const result = normalizeToolPart(
      part({ toolName: "TodoWrite", input: { todos: [] } }),
      "claude-code",
    );
    expect(result[0]!.kind).toBe("todo");
  });

  it("ExitPlanMode maps to plan", () => {
    const result = normalizeToolPart(
      part({ toolName: "ExitPlanMode", input: { plan: "## Plan\n..." } }),
      "claude-code",
    );
    expect(result[0]!.kind).toBe("plan");
  });

  it("Unknown tool falls back to other", () => {
    const result = normalizeToolPart(
      part({ toolName: "mcp__github__list_prs", input: { repo: "acme/web" } }),
      "claude-code",
    );
    expect(result[0]!.kind).toBe("other");
    if (result[0]!.kind === "other") {
      expect(result[0]!.payload.toolName).toBe("mcp__github__list_prs");
    }
  });
});
