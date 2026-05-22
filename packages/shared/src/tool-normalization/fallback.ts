import type { NormalizableToolUIPart, NormalizedToolAction } from "./types";
import { toolPartName } from "./utils/tool-part";

/**
 * Generic "other" action used when a provider's normalizer can't classify a
 * tool part. Has no provider or tool-name knowledge.
 */
export function fallbackOtherAction(part: NormalizableToolUIPart): NormalizedToolAction {
  const toolName = toolPartName(part);
  const input = "input" in part ? (part as { input?: unknown }).input : undefined;
  const output = "output" in part ? (part as { output?: unknown }).output : undefined;
  const errorText = "errorText" in part ? (part as { errorText?: string }).errorText : undefined;
  return {
    kind: "other",
    toolName,
    toolCallId: part.toolCallId,
    state: part.state,
    errorText,
    payload: { toolName, input, output },
  };
}
