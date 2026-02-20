import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

/**
 * Generate a short, descriptive session title from the user's first message
 * using a lightweight LLM call. Falls back to truncation if the call fails.
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
      system:
        "Generate a short title (max 6 words) summarizing what the user wants to do. " +
        "Respond with only the title, no quotes or punctuation. " +
        "Examples: 'Add dark mode toggle', 'Fix login redirect bug', 'Refactor auth middleware'.",
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    const text = result.text.trim();

    if (text.length > 0) {
      return text;
    }
  } catch (error) {
    console.error("Failed to generate session title via LLM:", error);
  }

  // Fallback: truncate the first message
  return userMessage.length > 60
    ? userMessage.substring(0, 57).replace(/\s+\S*$/, "") + "..."
    : userMessage;
}
