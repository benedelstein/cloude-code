import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { dedent } from "@repo/shared";
import { createLogger } from "@/lib/logger";

const DEFAULT_SESSION_TITLE = "Unknown request";
const MAX_TITLE_WORDS = 6;
const MAX_TITLE_CHARS = 60;
const logger = createLogger("generate-session-title.ts");
const SESSION_TITLE_SYSTEM_PROMPT = dedent`
  Generate a short title (max 6 words) summarizing what the user wants to do.
  Respond with only the title, no quotes or punctuation.
  If the request is unclear or absent, respond with something concise like 'Unknown request'.
  Examples: 'Add dark mode toggle', 'Fix login redirect bug', 'Refactor auth middleware'.
  ALWAYS respond with just a title, never a clarification message or explanation.
`;

function normalizeTitle(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?;:]+$/g, "")
    .trim();
}

function isValidTitle(text: string): boolean {
  if (!text) {
    return false;
  }

  if (text.length > MAX_TITLE_CHARS) {
    return false;
  }

  const words = text.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_TITLE_WORDS) {
    return false;
  }

  if (text.includes("?")) {
    return false;
  }

  return true;
}

/**
 * Generate a short, descriptive session title from the user's first message
 * using a lightweight LLM call. Falls back to "Unknown request" if invalid.
 */
export async function generateSessionTitle(
  anthropicApiKey: string,
  userMessage: string,
): Promise<string> {
  try {
    const anthropic = createAnthropic({ apiKey: anthropicApiKey });

    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      maxOutputTokens: 30,
      system: SESSION_TITLE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    const text = normalizeTitle(result.text);

    if (isValidTitle(text)) {
      return text;
    }
  } catch (error) {
    logger.error("Failed to generate session title via LLM", { error });
  }

  return DEFAULT_SESSION_TITLE;
}
