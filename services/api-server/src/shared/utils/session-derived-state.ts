import type { UIMessage } from "ai";
import { SessionTodo } from "@repo/shared";
import { z } from "zod";

type MessagePart = UIMessage["parts"][number];

type DynamicToolPart = MessagePart & {
  type: "dynamic-tool";
  toolName: string;
  input?: unknown;
  args?: unknown;
  output?: unknown;
};

type DerivedStateSnapshot = {
  todos?: z.infer<typeof SessionTodo>[] | null;
  plan?: string | null;
};

const TodoWriteInput = z.object({
  todos: z.array(SessionTodo),
});

const TaskCreateInput = z.object({
  subject: z.string().min(1),
  activeForm: z.string().optional(),
});

const TaskUpdateInput = z.object({
  taskId: z.union([z.string(), z.number()]).transform((value) => String(value)),
  subject: z.string().min(1).optional(),
  activeForm: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "deleted"]).optional(),
  delete: z.boolean().optional(),
  deleted: z.boolean().optional(),
});

const UpdatePlanInput = z.object({
  plan: z.array(z.object({
    step: z.string(),
    status: z.enum(["pending", "inProgress", "completed"]),
  })),
});

const ExitPlanModeInput = z.object({
  plan: z.string().refine((value) => value.trim().length > 0),
});

interface DerivedStateToolAdapter {
  readonly toolName: string;
  extract: (
    part: DynamicToolPart,
    currentTodos: z.infer<typeof SessionTodo>[] | null,
  ) => DerivedStateSnapshot | null;
}

function isDynamicToolPart(part: MessagePart): part is DynamicToolPart {
  return part.type === "dynamic-tool" && typeof (part as { toolName?: unknown }).toolName === "string";
}

function getPartInput(part: Pick<DynamicToolPart, "input" | "args">): unknown {
  return part.args ?? part.input;
}

function taskIdFromCreatePart(part: DynamicToolPart): string | undefined {
  const input = getPartInput(part);
  if (input && typeof input === "object") {
    const inputRecord = input as Record<string, unknown>;
    const inputId = inputRecord.id ?? inputRecord.taskId;
    if (typeof inputId === "string" || typeof inputId === "number") {
      return String(inputId);
    }
  }

  if (typeof part.output !== "string") {
    return undefined;
  }

  return /Task #([^ ]+) created successfully/.exec(part.output)?.[1];
}

function nextTaskTodos(
  currentTodos: z.infer<typeof SessionTodo>[] | null,
): z.infer<typeof SessionTodo>[] {
  return [...(currentTodos ?? [])];
}

function taskIndexById(todos: z.infer<typeof SessionTodo>[], taskId: string): number {
  const idIndex = todos.findIndex((todo) => todo.id === taskId);
  if (idIndex >= 0) {
    return idIndex;
  }

  const numericId = Number(taskId);
  if (Number.isInteger(numericId) && numericId > 0 && numericId <= todos.length) {
    return numericId - 1;
  }

  return -1;
}

class TodoWriteDerivedStateAdapter implements DerivedStateToolAdapter {
  readonly toolName = "TodoWrite";

  extract(part: DynamicToolPart): DerivedStateSnapshot | null {
    const parsed = TodoWriteInput.safeParse(getPartInput(part));
    if (!parsed.success) {
      return null;
    }

    return { todos: parsed.data.todos };
  }
}

class TaskCreateDerivedStateAdapter implements DerivedStateToolAdapter {
  readonly toolName = "TaskCreate";

  extract(
    part: DynamicToolPart,
    currentTodos: z.infer<typeof SessionTodo>[] | null,
  ): DerivedStateSnapshot | null {
    const parsed = TaskCreateInput.safeParse(getPartInput(part));
    if (!parsed.success) {
      return null;
    }

    const taskId = taskIdFromCreatePart(part);
    const todos = nextTaskTodos(currentTodos);
    const todo = {
      ...(taskId ? { id: taskId } : {}),
      content: parsed.data.subject,
      ...(parsed.data.activeForm ? { activeForm: parsed.data.activeForm } : {}),
      status: "pending" as const,
    };

    if (taskId) {
      const existingIndex = taskIndexById(todos, taskId);
      if (existingIndex >= 0) {
        todos[existingIndex] = todo;
        return { todos };
      }
    }

    return { todos: [...todos, todo] };
  }
}

class TaskUpdateDerivedStateAdapter implements DerivedStateToolAdapter {
  readonly toolName = "TaskUpdate";

  extract(
    part: DynamicToolPart,
    currentTodos: z.infer<typeof SessionTodo>[] | null,
  ): DerivedStateSnapshot | null {
    const parsed = TaskUpdateInput.safeParse(getPartInput(part));
    if (!parsed.success) {
      return null;
    }

    const todos = nextTaskTodos(currentTodos);
    const existingIndex = taskIndexById(todos, parsed.data.taskId);
    const shouldDelete = parsed.data.deleted === true
      || parsed.data.delete === true
      || parsed.data.status === "deleted";

    if (shouldDelete) {
      if (existingIndex < 0) {
        return { todos };
      }
      return { todos: todos.filter((_, index) => index !== existingIndex) };
    }

    const status = parsed.data.status === "deleted" ? undefined : parsed.data.status;
    const patch = {
      ...(parsed.data.subject ? { content: parsed.data.subject } : {}),
      ...(parsed.data.activeForm ? { activeForm: parsed.data.activeForm } : {}),
      ...(status ? { status } : {}),
    };

    if (existingIndex >= 0) {
      todos[existingIndex] = { ...todos[existingIndex]!, ...patch };
      return { todos };
    }

    return {
      todos: [
        ...todos,
        {
          id: parsed.data.taskId,
          content: parsed.data.subject ?? `Task #${parsed.data.taskId}`,
          ...(parsed.data.activeForm ? { activeForm: parsed.data.activeForm } : {}),
          status: status ?? "pending",
        },
      ],
    };
  }
}

class CodexUpdatePlanDerivedStateAdapter implements DerivedStateToolAdapter {
  readonly toolName = "update_plan";

  extract(part: DynamicToolPart): DerivedStateSnapshot | null {
    const parsed = UpdatePlanInput.safeParse(getPartInput(part));
    if (!parsed.success) {
      return null;
    }

    return {
      todos: parsed.data.plan.map((item) => ({
        content: item.step,
        status: item.status === "inProgress" ? "in_progress" : item.status,
      })),
    };
  }
}

class ExitPlanModeDerivedStateAdapter implements DerivedStateToolAdapter {
  readonly toolName = "ExitPlanMode";

  extract(part: DynamicToolPart): DerivedStateSnapshot | null {
    const parsed = ExitPlanModeInput.safeParse(getPartInput(part));
    if (!parsed.success) {
      return null;
    }

    return { plan: parsed.data.plan };
  }
}

const DERIVED_STATE_TOOL_ADAPTERS: readonly DerivedStateToolAdapter[] = [
  new TodoWriteDerivedStateAdapter(),
  new TaskCreateDerivedStateAdapter(),
  new TaskUpdateDerivedStateAdapter(),
  new CodexUpdatePlanDerivedStateAdapter(),
  new ExitPlanModeDerivedStateAdapter(),
];

const DERIVED_STATE_TOOL_ADAPTERS_BY_NAME = new Map(
  DERIVED_STATE_TOOL_ADAPTERS.map((adapter) => [adapter.toolName, adapter]),
);

export function extractDerivedStateFromPart(
  part: MessagePart,
  currentTodos: z.infer<typeof SessionTodo>[] | null = null,
): DerivedStateSnapshot | null {
  if (!isDynamicToolPart(part)) {
    return null;
  }

  const adapter = DERIVED_STATE_TOOL_ADAPTERS_BY_NAME.get(part.toolName);
  if (!adapter) {
    return null;
  }

  return adapter.extract(part, currentTodos);
}
