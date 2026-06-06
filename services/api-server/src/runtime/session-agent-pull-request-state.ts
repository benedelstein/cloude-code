import { PullRequestClientState, PullRequestState, type ClientState } from "@repo/shared";
import { z } from "zod";

const LegacyPullRequestClientState = z.object({
  url: z.string(),
  number: z.number(),
  state: PullRequestState,
});

export function normalizePullRequestState(value: unknown): ClientState["pullRequest"] | null {
  const parseResult = PullRequestClientState.safeParse(value);
  if (parseResult.success) {
    return parseResult.data.status === "creating" ? null : parseResult.data;
  }

  const legacyParseResult = LegacyPullRequestClientState.safeParse(value);
  if (!legacyParseResult.success) {
    return null;
  }

  return {
    status: "created",
    ...legacyParseResult.data,
  };
}
