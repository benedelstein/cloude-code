import type { UIMessage } from "ai";
import type { AgentState, SessionTodo } from "@repo/shared";
import { extractPlanSnapshotFromPart, extractTodoSnapshotFromPart } from "@/lib/session-derived-state";
import type { LatestPlanRepository } from "./repositories/latest-plan-repository";

type DerivedStateContext = {
  state: AgentState;
  latestPlanRepository: LatestPlanRepository;
  updatePartialState: (partial: Partial<AgentState>) => void;
};

export function applyDerivedStateFromParts(
  context: DerivedStateContext,
  completedParts: UIMessage["parts"],
  sourceMessageId: string | null,
): void {
  if (!context.state.sessionId || completedParts.length === 0) {
    return;
  }

  let nextTodos: SessionTodo[] | null | undefined;
  let nextPlanUpdatedAt: string | null = null;
  let planAvailable = context.state.planAvailable;

  for (const completedPart of completedParts) {
    const todos = extractTodoSnapshotFromPart(completedPart);
    if (todos) {
      nextTodos = todos;
    }

    const plan = extractPlanSnapshotFromPart(completedPart);
    if (plan) {
      const storedPlan = context.latestPlanRepository.upsert(
        context.state.sessionId,
        plan,
        sourceMessageId,
      );
      nextPlanUpdatedAt = storedPlan.updatedAt;
      planAvailable = true;
    }
  }

  if (nextTodos !== undefined || nextPlanUpdatedAt !== null) {
    context.updatePartialState({
      ...(nextTodos !== undefined ? { todos: nextTodos } : {}),
      ...(nextPlanUpdatedAt !== null
        ? {
            planAvailable,
            planUpdatedAt: nextPlanUpdatedAt,
          }
        : {}),
    });
  }
}
