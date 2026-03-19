import type { UIMessage } from "ai";
import type { AgentState, SessionTodo } from "@repo/shared";
import { extractPlanSnapshotFromPart, extractTodoSnapshotFromPart } from "@/lib/session-derived-state";
import type { LatestPlanRepository } from "./repositories/latest-plan-repository";

type DerivedStateContext = {
  state: AgentState;
  latestPlanRepository: LatestPlanRepository;
  // TODO: scope this down so it can only update todos and plan.
  // eslint-disable-next-line no-unused-vars
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
  let nextPlanLastUpdated: string | null = null;

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
      nextPlanLastUpdated = storedPlan.updatedAt;
    }
  }

  if (nextTodos !== undefined || nextPlanLastUpdated !== null) {
    context.updatePartialState({
      ...(nextTodos !== undefined ? { todos: nextTodos } : {}),
      ...(nextPlanLastUpdated !== null
        ? {
            plan: {
              lastUpdated: nextPlanLastUpdated,
            },
          }
        : {}),
    });
  }
}
