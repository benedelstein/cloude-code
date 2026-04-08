import type { UIMessage } from "ai";
import type { ClientState, SessionTodo } from "@repo/shared";
import { extractDerivedStateFromPart } from "@/lib/session-derived-state";
import type { LatestPlanRepository } from "./repositories/latest-plan-repository";

export type DerivedStateContext = {
  sessionId: string;
  latestPlanRepository: LatestPlanRepository;
  // TODO: scope this down so it can only update todos and plan.
  // eslint-disable-next-line no-unused-vars
  updatePartialState: (partial: Partial<ClientState>) => void;
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
  let nextPlanLastUpdated: string | null = null;

  for (const completedPart of completedParts) {
    const derivedState = extractDerivedStateFromPart(completedPart);
    if (!derivedState) {
      continue;
    }

    if (derivedState.todos !== undefined) {
      nextTodos = derivedState.todos;
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
