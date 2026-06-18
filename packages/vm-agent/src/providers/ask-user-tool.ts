/**
 * In-process MCP tool that lets the agent ask the user a question mid-turn and
 * block until they answer. The built-in `AskUserQuestion` tool cannot return a
 * real answer in headless mode (its result is auto-resolved), so we replace it
 * with a tool whose executor we control: it emits a `question` event outward,
 * then awaits the answer delivered back through the QuestionRegistry.
 */
import { createSdkMcpServer, tool } from "ai-sdk-provider-claude-code";
import { z } from "zod";
import type { AgentQuestionResponse } from "@repo/shared";
import type { QuestionRegistry } from "../lib/question-registry";
import type { ProviderSetupContext } from "../lib/agent-harness";

export const ASK_USER_SERVER_NAME = "cloude";
export const ASK_USER_TOOL_NAME = "ask_user";
/** The native tool we disable in favour of `ask_user`. */
export const NATIVE_ASK_TOOL_NAME = "AskUserQuestion";
/** Fully-qualified MCP tool name as the model sees it. */
export const ASK_USER_FULL_TOOL_NAME = `mcp__${ASK_USER_SERVER_NAME}__${ASK_USER_TOOL_NAME}`;

function formatResponses(responses: AgentQuestionResponse[]): string {
  if (responses.length === 0) {
    return "The user dismissed the question without selecting an option.";
  }
  return responses
    .map((r) => `${r.header}: ${r.selected.length ? r.selected.join(", ") : "(no selection)"}`)
    .join("\n");
}

export function createAskUserMcpServer(
  registry: QuestionRegistry,
  emit: ProviderSetupContext["emit"],
  generateQuestionId: () => string,
) {
  const askUser = tool(
    ASK_USER_TOOL_NAME,
    "Ask the user one or more multiple-choice questions and block until they " +
      "answer. Use this whenever you need the user to make a decision or " +
      "clarify requirements before continuing. Each question must offer 2-4 " +
      "concrete options.",
    {
      questions: z
        .array(
          z.object({
            question: z.string().min(1).describe("The question to ask the user."),
            header: z
              .string()
              .min(1)
              .describe("Short label shown as a chip/tag (max 12 chars)."),
            options: z
              .array(
                z.object({
                  label: z.string().min(1).describe("The option text shown to the user."),
                  description: z
                    .string()
                    .optional()
                    .describe("Optional explanation of what this option means."),
                }),
              )
              .min(2)
              .max(4)
              .describe("2-4 mutually exclusive options."),
            multiSelect: z
              .boolean()
              .optional()
              .describe("Allow selecting multiple options."),
          }),
        )
        .min(1)
        .describe("One or more questions to ask the user."),
    },
    async (args) => {
      const questionId = generateQuestionId();
      emit({ type: "question", questionId, questions: args.questions });

      try {
        const responses = await registry.register(questionId);
        return { content: [{ type: "text", text: formatResponses(responses) }] };
      } catch {
        return {
          content: [
            {
              type: "text",
              text: "The question was cancelled before the user answered.",
            },
          ],
          isError: true,
        };
      }
    },
  );

  return createSdkMcpServer({
    name: ASK_USER_SERVER_NAME,
    version: "1.0.0",
    tools: [askUser],
  });
}
