import type { DynamicToolUIPart } from "ai";
import type { NormalizedToolAction } from "./types";

/**
 * Generic "other" action used when a provider's normalizer can't classify a
 * tool part. Has no provider or tool-name knowledge.
 */
export function fallbackOtherAction(part: DynamicToolUIPart): NormalizedToolAction {
  const input = "input" in part ? (part as { input?: unknown }).input : undefined;
  const output = "output" in part ? (part as { output?: unknown }).output : undefined;
  const errorText = "errorText" in part ? (part as { errorText?: string }).errorText : undefined;
  return {
    kind: "other",
    toolName: part.toolName,
    toolCallId: part.toolCallId,
    state: part.state,
    errorText,
    payload: { toolName: part.toolName, input, output },
  };
}
