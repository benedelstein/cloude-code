import type { DynamicToolUIPart } from "ai";
import type { NormalizedToolAction, ToolPartNormalizer } from "../types";
import { fallbackOtherAction } from "../fallback";
import { lineDiff } from "../utils/diff";

interface PartContext {
  state: NormalizedToolAction["state"];
  errorText?: string;
  toolCallId: string;
  toolName: string;
}

function ctx(part: DynamicToolUIPart): PartContext {
  const errorText = "errorText" in part ? (part as { errorText?: string }).errorText : undefined;
  return {
    state: part.state,
    errorText,
    toolCallId: part.toolCallId,
    toolName: part.toolName,
  };
}

function getInput(part: DynamicToolUIPart): Record<string, unknown> {
  const value = "input" in part ? (part as { input?: unknown }).input : undefined;
  return (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
}

function getOutput(part: DynamicToolUIPart): unknown {
  return "output" in part ? (part as { output?: unknown }).output : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const handlers: Record<string, (part: DynamicToolUIPart) => NormalizedToolAction[]> = {
  Read: (part) => {
    const input = getInput(part);
    const filePath = asString(input.file_path);
    return [{
      kind: "read",
      ...ctx(part),
      payload: { paths: filePath ? [filePath] : [] },
    }];
  },

  Edit: (part) => {
    const input = getInput(part);
    const filePath = asString(input.file_path);
    const oldString = asString(input.old_string);
    const newString = asString(input.new_string);
    const diff = oldString || newString ? lineDiff(oldString, newString) : "";
    return [{
      kind: "edit",
      ...ctx(part),
      payload: { path: filePath, diff },
    }];
  },

  MultiEdit: (part) => {
    const input = getInput(part);
    const filePath = asString(input.file_path);
    const edits = Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : [];
    if (edits.length === 0) {
      return [{
        kind: "edit",
        ...ctx(part),
        payload: { path: filePath, diff: "" },
      }];
    }
    return edits.map((edit) => ({
      kind: "edit" as const,
      ...ctx(part),
      payload: {
        path: filePath,
        diff: lineDiff(asString(edit.old_string), asString(edit.new_string)),
      },
    }));
  },

  Write: (part) => {
    const input = getInput(part);
    const filePath = asString(input.file_path);
    const content = asString(input.content);
    return [{
      kind: "write",
      ...ctx(part),
      payload: {
        path: filePath,
        content: content.length > 0 ? content : undefined,
        isNew: true,
      },
    }];
  },

  Bash: (part) => {
    const input = getInput(part);
    const command = asString(input.command);
    const output = getOutput(part);
    return [{
      kind: "bash",
      ...ctx(part),
      payload: {
        command,
        output: typeof output === "string" ? output : undefined,
      },
    }];
  },

  Grep: (part) => {
    const input = getInput(part);
    const pattern = asString(input.pattern);
    return [{
      kind: "search",
      ...ctx(part),
      payload: { patterns: pattern ? [pattern] : [] },
    }];
  },

  Glob: (part) => {
    const input = getInput(part);
    const pattern = asString(input.pattern);
    return [{
      kind: "search",
      ...ctx(part),
      payload: { patterns: pattern ? [pattern] : [] },
    }];
  },

  WebFetch: (part) => {
    const input = getInput(part);
    return [{
      kind: "web",
      ...ctx(part),
      payload: { kind: "fetch", url: asString(input.url) || undefined },
    }];
  },

  WebSearch: (part) => {
    const input = getInput(part);
    return [{
      kind: "web",
      ...ctx(part),
      payload: { kind: "search", query: asString(input.query) || undefined },
    }];
  },

  TodoWrite: (part) => {
    const input = getInput(part);
    return [{
      kind: "todo",
      ...ctx(part),
      payload: { todos: input.todos },
    }];
  },

  ExitPlanMode: (part) => {
    const input = getInput(part);
    return [{
      kind: "plan",
      ...ctx(part),
      payload: { plan: asString(input.plan) },
    }];
  },
};

export const claudeToolNormalizer: ToolPartNormalizer = {
  normalize(part) {
    const handler = handlers[part.toolName];
    return handler ? handler(part) : [fallbackOtherAction(part)];
  },
};
