import type { UIMessage } from "ai";

/**
 * Stored message wraps UIMessage with session metadata.
 */
export interface StoredMessage {
  sessionId: string;
  createdAt: string;
  message: UIMessage;
}

interface MessageRow {
  id: string;
  session_id: string;
  message: string; // JSON-serialized UIMessage
  created_at: string;
}

// Tagged template SQL function type from Agent SDK
type SqlFn = <T = Record<string, string | number | boolean | null>>(
  strings: TemplateStringsArray,
  ...values: (string | number | boolean | null)[]
) => T[];

export class MessageRepository {
  constructor(private sql: SqlFn) {}

  /**
   * Store a UIMessage.
   */
  create(sessionId: string, message: UIMessage): StoredMessage {
    const messageJson = JSON.stringify(message);
    const createdAt = new Date().toISOString();

    this.sql`
      INSERT INTO messages (id, session_id, message, created_at)
      VALUES (${message.id}, ${sessionId}, ${messageJson}, ${createdAt})
    `;

    return {
      sessionId,
      createdAt,
      message,
    };
  }

  getById(id: string): StoredMessage | null {
    const rows = this.sql<MessageRow>`SELECT * FROM messages WHERE id = ${id}`;
    const row = rows[0];
    if (!row) return null;
    return this.rowToStoredMessage(row);
  }

  getAllBySession(sessionId: string): StoredMessage[] {
    const rows = this.sql<MessageRow>`
      SELECT * FROM messages WHERE session_id = ${sessionId} ORDER BY created_at ASC
    `;
    return rows.map((row) => this.rowToStoredMessage(row));
  }

  delete(id: string): void {
    this.sql`DELETE FROM messages WHERE id = ${id}`;
  }

  private rowToStoredMessage(row: MessageRow): StoredMessage {
    return {
      sessionId: row.session_id,
      createdAt: row.created_at,
      message: JSON.parse(row.message) as UIMessage,
    };
  }
}
