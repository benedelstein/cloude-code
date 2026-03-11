export interface GitHubUserRecord {
  id: string;
  githubLogin: string;
  githubName: string | null;
  githubAvatarUrl: string | null;
}

interface GitHubUserRow {
  id: string;
  github_login: string;
  github_name: string | null;
  github_avatar_url: string | null;
}

interface UpsertGitHubUserInput {
  id: string;
  githubId: number;
  githubLogin: string;
  githubName: string | null;
  githubAvatarUrl: string | null;
}

export class UserRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async upsertGitHubUser(input: UpsertGitHubUserInput): Promise<void> {
    await this.database.prepare(
      `INSERT INTO users (id, github_id, github_login, github_name, github_avatar_url)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (github_id) DO UPDATE SET
         github_login = excluded.github_login,
         github_name = excluded.github_name,
         github_avatar_url = excluded.github_avatar_url,
         updated_at = datetime('now')`,
    )
      .bind(
        input.id,
        input.githubId,
        input.githubLogin,
        input.githubName,
        input.githubAvatarUrl,
      )
      .run();
  }

  async getByGitHubId(githubId: number): Promise<GitHubUserRecord | null> {
    const row = await this.database.prepare(
      `SELECT id, github_login, github_name, github_avatar_url FROM users WHERE github_id = ?`,
    )
      .bind(githubId)
      .first<GitHubUserRow>();

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      githubLogin: row.github_login,
      githubName: row.github_name,
      githubAvatarUrl: row.github_avatar_url,
    };
  }
}
