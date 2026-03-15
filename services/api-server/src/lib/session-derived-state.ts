import type { UIMessage } from "ai";
import { SessionTodo } from "@repo/shared";
import { z } from "zod";

type MessagePart = UIMessage["parts"][number];

const TodoWriteInput = z.object({
  todos: z.array(SessionTodo),
});

const ExitPlanModeInput = z.object({
  plan: z.string().refine((value) => value.trim().length > 0),
});

function isDynamicToolPart(part: MessagePart): part is MessagePart & {
  type: "dynamic-tool";
  toolName: string;
  input?: unknown;
  args?: unknown;
} {
  return part.type === "dynamic-tool" && typeof (part as { toolName?: unknown }).toolName === "string";
}

function getPartInput(part: { input?: unknown; args?: unknown }): unknown {
  return part.args ?? part.input;
}

export function extractTodoSnapshotFromPart(part: MessagePart) {
  if (!isDynamicToolPart(part) || part.toolName !== "TodoWrite") {
    return null;
  }

  const parsed = TodoWriteInput.safeParse(getPartInput(part));
  if (!parsed.success) {
    return null;
  }

  return parsed.data.todos;
}

export function extractPlanSnapshotFromPart(part: MessagePart) {
  if (!isDynamicToolPart(part) || part.toolName !== "ExitPlanMode") {
    return null;
  }

  const parsed = ExitPlanModeInput.safeParse(getPartInput(part));
  if (!parsed.success) {
    return null;
  }

  return parsed.data.plan;
}
