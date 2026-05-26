import type { Logger } from "@repo/shared";
import { generateSessionTitle } from "@/shared/utils/generate-session-title";
import type { MessageRepository } from "./repositories/message-repository";

export async function updateSessionHistoryData(params: {
  database: D1Database;
  anthropicApiKey: string;
  logger: Logger;
  sessionId: string;
  messageContent: string;
  messageRepository: MessageRepository;
}): Promise<void> {
  const {
    database,
    anthropicApiKey,
    logger: baseLogger,
    sessionId,
    messageContent,
    messageRepository,
  } = params;
  const logger = baseLogger.scope("session-agent-history.ts");

  try {
    await database
      .prepare(`UPDATE sessions SET last_message_at = datetime('now') WHERE id = ?`)
      .bind(sessionId)
      .run();

    // Check if this is the first user message — if so, generate a title via LLM
    // TODO: more efficient query. store message sender in d1 as toplevel column.
    const userMessages = messageRepository.getAllBySession(sessionId)
      .filter((m) => m.message.role === "user");

    if (userMessages.length === 1) {
      const title = await generateSessionTitle(anthropicApiKey, messageContent);
      logger.info("Generated session title", {
        fields: { sessionId, title },
      });
      await database
        .prepare(`UPDATE sessions SET title = ? WHERE id = ?`)
        .bind(title, sessionId)
        .run();
    }
  } catch (error) {
    logger.error("Failed to sync message to D1 history", { error });
  }
}
