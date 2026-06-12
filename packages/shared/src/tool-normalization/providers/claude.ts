import type { NormalizableToolUIPart, NormalizedToolAction, ToolPartNormalizer } from "../types";
import { fallbackOtherAction } from "../fallback";
import { lineDiff } from "../utils/diff";
import { toolPartName } from "../utils/tool-part";

interface PartContext {
  state: NormalizedToolAction["state"];
  errorText?: string;
  toolCallId: string;
  toolName: string;
}

function ctx(part: NormalizableToolUIPart): PartContext {
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
  return (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
}

function getOutput(part: NormalizableToolUIPart): unknown {
  return "output" in part ? (part as { output?: unknown }).output : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asTaskId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function taskStatus(value: unknown): string {
  const status = asString(value);
  return status === "pending" || status === "in_progress" || status === "completed"
    ? status
    : "pending";
}

function taskTodo(input: Record<string, unknown>): Record<string, unknown> {
  const taskId = asTaskId(input.taskId ?? input.id);
  const subject = asString(input.subject);
  const content = subject || (taskId ? `Task #${taskId}` : "Task");
  return {
    ...(taskId ? { id: taskId } : {}),
    content,
    ...(asString(input.activeForm) ? { activeForm: asString(input.activeForm) } : {}),
    status: taskStatus(input.status),
  };
}

function taskListTodos(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.map((item) => (item && typeof item === "object" ? taskTodo(item as Record<string, unknown>) : item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const tasks = record.tasks ?? record.todos;
    if (Array.isArray(tasks)) {
      return taskListTodos(tasks);
    }
    if (record.subject || record.content || record.taskId || record.id) {
      return [taskTodo({
        ...record,
        subject: record.subject ?? record.content,
      })];
    }
  }
  return [];
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

function readLineRange(input: Record<string, unknown>): { start: number; end?: number } | undefined {
  const offset = asPositiveInteger(input.offset);
  const limit = asPositiveInteger(input.limit);
  if (offset === undefined && limit === undefined) { return undefined; }

  const start = offset ?? 1;
  return {
    start,
    end: limit === undefined ? undefined : start + limit - 1,
  };
}

const handlers: Record<string, (part: NormalizableToolUIPart) => NormalizedToolAction[]> = {
  Read: (part) => {
    const input = getInput(part);
    const output = getOutput(part);
    const filePath = asString(input.file_path);
    return [{
      kind: "read",
      ...ctx(part),
      payload: {
        paths: filePath ? [filePath] : [],
        lineRange: readLineRange(input),
        content: typeof output === "string" ? output : undefined,
      },
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

  TaskCreate: (part) => {
    const input = getInput(part);
    return [{
      kind: "todo",
      ...ctx(part),
      payload: { todos: [taskTodo(input)] },
    }];
  },

  TaskUpdate: (part) => {
    const input = getInput(part);
    return [{
      kind: "todo",
      ...ctx(part),
      payload: { todos: [taskTodo(input)] },
    }];
  },

  TaskList: (part) => {
    const input = getInput(part);
    const outputTodos = taskListTodos(getOutput(part));
    return [{
      kind: "todo",
      ...ctx(part),
      payload: { todos: outputTodos.length > 0 ? outputTodos : taskListTodos(input.tasks ?? input.todos) },
    }];
  },

  TaskGet: (part) => {
    const input = getInput(part);
    const outputTodos = taskListTodos(getOutput(part));
    return [{
      kind: "todo",
      ...ctx(part),
      payload: { todos: outputTodos.length > 0 ? outputTodos : [taskTodo(input)] },
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
    const handler = handlers[toolPartName(part)];
    return handler ? handler(part) : [fallbackOtherAction(part)];
  },
};
