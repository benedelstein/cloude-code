import type { AgentQuestionResponse } from "@repo/shared";

/**
 * Tracks `ask_user` tool calls that are blocking the turn while waiting for a
 * user response. The tool executor registers a question and awaits the
 * returned promise; the runner resolves it when an `answer` arrives on stdin.
 *
 * Only one question can realistically be outstanding at a time because the
 * `ask_user` tool blocks the model from proceeding, but the registry is keyed
 * by `questionId` so answers route deterministically.
 */
export class QuestionRegistry {
  private readonly pending = new Map<
    string,
    {
      resolve: (_responses: AgentQuestionResponse[]) => void;
      reject: (_error: unknown) => void;
    }
  >();

  register(questionId: string): Promise<AgentQuestionResponse[]> {
    return new Promise<AgentQuestionResponse[]>((resolve, reject) => {
      this.pending.set(questionId, { resolve, reject });
    });
  }

  /** Resolves a pending question. Returns false if the id is unknown/stale. */
  answer(questionId: string, responses: AgentQuestionResponse[]): boolean {
    const entry = this.pending.get(questionId);
    if (!entry) { return false; }
    this.pending.delete(questionId);
    entry.resolve(responses);
    return true;
  }

  /** Rejects every outstanding question (used on cancel/shutdown). */
  rejectAll(error: unknown): void {
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}
