import type { SessionSummary } from "@repo/shared";
import {
  type CreateSessionParams,
  SessionsRepository,
} from "@/repositories/sessions.repository";

export class SessionHistoryService {
  private readonly repository: SessionsRepository;

  constructor(database: D1Database) {
    this.repository = new SessionsRepository(database);
  }

  async create(params: CreateSessionParams): Promise<void> {
    await this.repository.create(params);
  }

  async updateTitle(sessionId: string, title: string): Promise<void> {
    await this.repository.updateTitle(sessionId, title);
  }

  async archive(sessionId: string): Promise<void> {
    await this.repository.archive(sessionId);
  }

  async delete(sessionId: string): Promise<void> {
    await this.repository.delete(sessionId);
  }

  async deleteAndQueueAttachmentGc(sessionId: string): Promise<void> {
    await this.repository.deleteAndQueueAttachmentGc(sessionId);
  }

  async updateLastMessageAt(sessionId: string): Promise<void> {
    await this.repository.updateLastMessageAt(sessionId);
  }

  async listByUser(
    userId: string,
    options: { repoId?: number; limit?: number; cursor?: string } = {},
  ): Promise<{ sessions: SessionSummary[]; cursor: string | null }> {
    return this.repository.listByUser(userId, options);
  }

  async getById(sessionId: string): Promise<SessionSummary | null> {
    return this.repository.getById(sessionId);
  }

  async isOwnedByUser(sessionId: string, userId: string): Promise<boolean> {
    return this.repository.isOwnedByUser(sessionId, userId);
  }
}
