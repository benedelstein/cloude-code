import {
  type AgentMode,
  type AgentInputMessage,
  type AgentQuestionResponse,
  decodeAgentInput,
} from "@repo/shared";

export interface WebhookStdinRunner {
  queueStdinMessage(
    userMessageId: string,
    message: AgentInputMessage,
    overrides?: { model?: string; effort?: string; agentMode?: AgentMode },
  ): void;
  cancelTurn(_userMessageId: string): void;
  deliverAnswer(_questionId: string, _responses: AgentQuestionResponse[]): void;
}

export type WebhookStdinLogger = (
  _level: "debug" | "warn",
  _message: string,
  _meta?: unknown,
) => void;

/**
 * Decodes one stdin NDJSON line and dispatches it to the webhook runner.
 */
export function handleWebhookStdinLine(
  rawLine: string,
  runner: WebhookStdinRunner,
  log: WebhookStdinLogger,
): void {
  const line = rawLine.charCodeAt(0) === 0 ? rawLine.slice(1) : rawLine;

  try {
    const input = decodeAgentInput(line);
    switch (input.type) {
      case "chat":
        runner.queueStdinMessage(input.userMessageId, input.message, {
          model: input.model,
          effort: input.effort,
          agentMode: input.agentMode,
        });
        break;
      case "cancel":
        log("debug", "cancel received on stdin; aborting current operation");
        runner.cancelTurn(input.userMessageId);
        break;
      case "answer":
        log("debug", "answer received on stdin; resolving pending question");
        runner.deliverAnswer(input.questionId, input.responses);
        break;
    }
  } catch (error) {
    log("warn", `Invalid stdin input: ${error}`);
  }
}
