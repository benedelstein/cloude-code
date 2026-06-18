import type { NormalizableToolUIPart, NormalizedToolAction, ToolPartNormalizer } from "../types";
import { fallbackOtherAction } from "../fallback";
import { toolPartName } from "../utils/tool-part";

function ctx(part: NormalizableToolUIPart) {
  const errorText = "errorText" in part ? (part as { errorText?: string }).errorText : undefined;
  return {
    state: part.state,
    errorText,
    toolCallId: part.toolCallId,
    toolName: toolPartName(part),
  };
}

function getInput(part: NormalizableToolUIPart): Record<string, unknown> {
  const value = "input" in part ? (part as { input?: unknown }).input : undefined;
  return asRecord(value);
}

function getOutput(part: NormalizableToolUIPart): unknown {
  return "output" in part ? (part as { output?: unknown }).output : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function codexWebSearchQuery(part: NormalizableToolUIPart, input: Record<string, unknown>): string | undefined {
  const inputQuery = asString(input.query);
  if (inputQuery) {
    return inputQuery;
  }

  const output = asRecord(getOutput(part));
  const action = asRecord(output.action);
  const actionQuery = asString(action.query);
  if (actionQuery) {
    return actionQuery;
  }

  const queries = Array.isArray(action.queries) ? action.queries : [];
  return asString(queries.find((query) => typeof query === "string")) || undefined;
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
    const name = toolPartName(part);

    if (name === "exec" || inputType === "commandExecution") {
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

    if (name === "patch" || inputType === "fileChange") {
      const changes = Array.isArray(input.changes) ? (input.changes as CodexChange[]) : [];
      if (changes.length === 0) {
        return [fallbackOtherAction(part)];
      }
      return changes.flatMap((change) => changeToActions(change, context));
    }

    if (name === "web_search" || inputType === "webSearch") {
      return [{
        kind: "web",
        ...context,
        payload: { kind: "search", query: codexWebSearchQuery(part, input) },
      }];
    }

    if (name === "update_plan") {
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
