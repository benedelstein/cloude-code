import type { Logger } from "@repo/shared";
import { SessionHistoryService } from "@/lib/session-history";
import { generateSessionTitle } from "@/lib/generate-session-title";
import type { MessageRepository } from "./repositories/message-repository";

export async function updateSessionHistoryData(params: {
  database: D1Database;
  anthropicApiKey: string;
  logger: Logger;
  sessionId: string;
  messageContent: string;
  messageRepository: MessageRepository;
}): Promise<void> {
  const { database, anthropicApiKey, logger, sessionId, messageContent, messageRepository } = params;

  try {
    const sessionHistory = new SessionHistoryService(database);
    await sessionHistory.updateLastMessageAt(sessionId);

    // Check if this is the first user message — if so, generate a title via LLM
    // TODO: more efficient query. store message sender in d1 as toplevel column.
    const userMessages = messageRepository.getAllBySession(sessionId)
      .filter((m) => m.message.role === "user");

    if (userMessages.length === 1) {
      const title = await generateSessionTitle(anthropicApiKey, messageContent);
      logger.info(`Generated session title: ${title} for session ${sessionId}`, {
        loggerName: "session-agent-history.ts",
      });
      await sessionHistory.updateTitle(sessionId, title);
    }
  } catch (error) {
    logger.error("Failed to sync message to D1 history", {
      loggerName: "session-agent-history.ts",
      error,
    });
  }
}
