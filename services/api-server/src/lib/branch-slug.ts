import Anthropic from "@anthropic-ai/sdk";

export async function generateBranchSlug(
  message: string,
  apiKey: string
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 100,
    messages: [{
      role: "user",
      content: `Generate a short git branch slug (2-4 words, lowercase, hyphens only) for this task: "${message.slice(0, 200)}".\n\nFor example, "add a new feature" might become "add-new-feature".\n\nOutput ONLY the slug, nothing else.`
    }],
  });

  const firstBlock = response.content[0];
  const text = firstBlock && firstBlock.type === "text" ? firstBlock.text : "";
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 30);
  const random = crypto.randomUUID().slice(0, 6);
  return `cloude/${slug}-${random}`;
}
