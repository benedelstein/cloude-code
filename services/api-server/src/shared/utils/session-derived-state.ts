import type { UIMessage } from "ai";
import { SessionTodo } from "@repo/shared";
import { z } from "zod";

type MessagePart = UIMessage["parts"][number];

type DynamicToolPart = MessagePart & {
  type: "dynamic-tool";
  toolName: string;
  input?: unknown;
  args?: unknown;
};

type DerivedStateSnapshot = {
  todos?: z.infer<typeof SessionTodo>[] | null;
  plan?: string | null;
};

const TodoWriteInput = z.object({
  todos: z.array(SessionTodo),
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
  extract: (...args: [DynamicToolPart]) => DerivedStateSnapshot | null;
}

function isDynamicToolPart(part: MessagePart): part is DynamicToolPart {
  return part.type === "dynamic-tool" && typeof (part as { toolName?: unknown }).toolName === "string";
}

function getPartInput(part: Pick<DynamicToolPart, "input" | "args">): unknown {
  return part.args ?? part.input;
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
  new CodexUpdatePlanDerivedStateAdapter(),
  new ExitPlanModeDerivedStateAdapter(),
];

const DERIVED_STATE_TOOL_ADAPTERS_BY_NAME = new Map(
  DERIVED_STATE_TOOL_ADAPTERS.map((adapter) => [adapter.toolName, adapter]),
);

export function extractDerivedStateFromPart(part: MessagePart): DerivedStateSnapshot | null {
  if (!isDynamicToolPart(part)) {
    return null;
  }

  const adapter = DERIVED_STATE_TOOL_ADAPTERS_BY_NAME.get(part.toolName);
  if (!adapter) {
    return null;
  }

  return adapter.extract(part);
}
