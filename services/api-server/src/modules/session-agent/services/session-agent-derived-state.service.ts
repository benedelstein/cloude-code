import type { UIMessage } from "ai";
import type { ClientState, SessionTodo } from "@repo/shared";
import { extractDerivedStateFromPart } from "@/shared/utils/session-derived-state";
import type { LatestPlanRepository } from "../repositories/latest-plan.repository";

export type DerivedStateContext = {
  sessionId: string;
  latestPlanRepository: LatestPlanRepository;
  getTodos?: () => ClientState["todos"];
  updatePartialState: (partial: Partial<Pick<ClientState, "todos" | "plan">>) => void;
};

export function applyDerivedStateFromParts(
  context: DerivedStateContext,
  completedParts: UIMessage["parts"],
  sourceMessageId: string | null,
): void {
  if (!context.sessionId || completedParts.length === 0) {
    return;
  }

  let nextTodos: SessionTodo[] | null | undefined;
  let workingTodos = context.getTodos?.() ?? null;
  let nextPlanLastUpdated: string | null = null;

  for (const completedPart of completedParts) {
    const derivedState = extractDerivedStateFromPart(completedPart, workingTodos);
    if (!derivedState) {
      continue;
    }

    if (derivedState.todos !== undefined) {
      nextTodos = derivedState.todos;
      workingTodos = derivedState.todos;
    }

    if (derivedState.plan) {
      const storedPlan = context.latestPlanRepository.upsert(
        context.sessionId,
        derivedState.plan,
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
