import Anthropic from "@anthropic-ai/sdk";

/**
 * Generate a short, descriptive session title from the user's first message
 * using a lightweight LLM call. Falls back to truncation if the call fails.
 */
export async function generateSessionTitle(
  apiKey: string,
  userMessage: string,
): Promise<string> {
  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 30,
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
      system:
        "Generate a short title (max 6 words) summarizing what the user wants to do. " +
        "Respond with only the title, no quotes or punctuation. " +
        "Examples: 'Add dark mode toggle', 'Fix login redirect bug', 'Refactor auth middleware'.",
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text.trim() : null;

    if (text && text.length > 0) {
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
