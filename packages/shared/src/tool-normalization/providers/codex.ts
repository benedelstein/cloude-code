import type { DynamicToolUIPart } from "ai";
import type { NormalizedToolAction, ToolPartNormalizer } from "../types";
import { fallbackOtherAction } from "../fallback";

function ctx(part: DynamicToolUIPart) {
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
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function getOutput(part: DynamicToolUIPart): unknown {
  return "output" in part ? (part as { output?: unknown }).output : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

interface CodexChange {
  path?: unknown;
  kind?: { type?: unknown };
  diff?: unknown;
  content?: unknown;
}

function changeToActions(
  change: CodexChange,
  context: ReturnType<typeof ctx>,
): NormalizedToolAction[] {
  const path = asString(change.path);
  const kindType = asString(change.kind?.type);
  switch (kindType) {
    case "update":
      return [{
        kind: "edit",
        ...context,
        payload: { path, diff: asString(change.diff) },
      }];
    case "add":
      return [{
        kind: "write",
        ...context,
        payload: {
          path,
          isNew: true,
          content: asString(change.content) || undefined,
        },
      }];
    case "delete":
      return [{
        kind: "write",
        ...context,
        payload: { path, deleted: true },
      }];
    default:
      return [{
        kind: "edit",
        ...context,
        payload: { path, diff: asString(change.diff) },
      }];
  }
}

export const codexToolNormalizer: ToolPartNormalizer = {
  normalize(part) {
    const input = getInput(part);
    const inputType = asString(input.type);
    const context = ctx(part);

    if (part.toolName === "exec" || inputType === "commandExecution") {
      const output = getOutput(part);
      const aggregatedOutput = output && typeof output === "object"
        ? (output as { aggregatedOutput?: unknown }).aggregatedOutput
        : undefined;
      const exitCode = output && typeof output === "object"
        ? (output as { exitCode?: unknown }).exitCode
        : undefined;
      return [{
        kind: "bash",
        ...context,
        payload: {
          command: asString(input.command),
          output: typeof aggregatedOutput === "string" ? aggregatedOutput : undefined,
          exitCode: typeof exitCode === "number" ? exitCode : null,
        },
      }];
    }

    if (part.toolName === "patch" || inputType === "fileChange") {
      const changes = Array.isArray(input.changes) ? (input.changes as CodexChange[]) : [];
      if (changes.length === 0) {
        return [fallbackOtherAction(part)];
      }
      return changes.flatMap((change) => changeToActions(change, context));
    }

    if (part.toolName === "update_plan") {
      const plan = input.plan ?? input.steps;
      return [{
        kind: "todo",
        ...context,
        payload: { todos: plan },
      }];
    }

    return [fallbackOtherAction(part)];
  },
};
