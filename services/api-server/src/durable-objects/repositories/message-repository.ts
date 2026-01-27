export interface Message {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  rawData?: unknown;
  createdAt: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  raw_data: string | null;
  created_at: string;
}

// Tagged template SQL function type from Agent SDK
type SqlFn = <T = Record<string, string | number | boolean | null>>(
  strings: TemplateStringsArray,
  ...values: (string | number | boolean | null)[]
) => T[];

export class MessageRepository {
  constructor(private sql: SqlFn) {}

  create(params: {
    sessionId: string;
    role: "assistant" | "user" | "system";
    content: string;
    rawData?: unknown;
  }): Message {
    const id = crypto.randomUUID();
    const rawDataJson = params.rawData ? JSON.stringify(params.rawData) : null;
    const createdAt = new Date().toISOString();

    this.sql`
      INSERT INTO messages (id, session_id, role, content, raw_data, created_at)
      VALUES (${id}, ${params.sessionId}, ${params.role}, ${params.content}, ${rawDataJson}, ${createdAt})
    `;

    return {
      id,
      sessionId: params.sessionId,
      role: params.role,
      content: params.content,
      rawData: params.rawData,
      createdAt,
    };
  }

  getById(id: string): Message | null {
    const rows = this.sql<MessageRow>`SELECT * FROM messages WHERE id = ${id}`;
    const row = rows[0];

    if (!row) return null;
    return this.rowToMessage(row);
  }

  getAllBySession(sessionId: string): Message[] {
    const rows = this.sql<MessageRow>`
      SELECT * FROM messages WHERE session_id = ${sessionId} ORDER BY created_at ASC
    `;

    return rows.map((row) => this.rowToMessage(row));
  }

  delete(id: string): void {
    this.sql`DELETE FROM messages WHERE id = ${id}`;
  }

  private rowToMessage(row: MessageRow): Message {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      rawData: row.raw_data ? JSON.parse(row.raw_data) : undefined,
      createdAt: row.created_at,
    };
  }
}
