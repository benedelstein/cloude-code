import type { Logger } from "@repo/shared";
import { SessionsRepository } from "@/repositories/sessions.repository";
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
    const sessionsRepository = new SessionsRepository(database);
    await sessionsRepository.updateLastMessageAt(sessionId);

    // Check if this is the first user message — if so, generate a title via LLM
    // TODO: more efficient query. store message sender in d1 as toplevel column.
    const userMessages = messageRepository.getAllBySession(sessionId)
      .filter((m) => m.message.role === "user");

    if (userMessages.length === 1) {
      const title = await generateSessionTitle(anthropicApiKey, messageContent);
      logger.info(`Generated session title: ${title} for session ${sessionId}`);
      await sessionsRepository.updateTitle(sessionId, title);
    }
  } catch (error) {
    logger.error("Failed to sync message to D1 history", { error });
  }
}
