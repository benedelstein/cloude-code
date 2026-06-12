import { describe, expect, it } from "vitest";
import { UserSessionRepository } from "../../src/modules/auth/repositories/user-session.repository";

class MockD1 {
  users = new Map<string, { github_id: number }>();
  authSessions = new Set<string>();
  refreshSessions = new Set<string>();
  credentials = new Set<string>();

  asD1(): D1Database {
    return {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            this.execute(sql, args);
            return { success: true };
          },
        }),
      }),
      batch: async (statements: Array<{ run(): Promise<unknown> }>) => {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        return results;
      },
    } as unknown as D1Database;
  }

  seedUser(userId: string, githubId: number): void {
    this.users.set(userId, { github_id: githubId });
    this.authSessions.add(userId);
    this.refreshSessions.add(userId);
    this.credentials.add(userId);
  }

  private execute(sql: string, args: unknown[]): void {
    if (sql.includes("DELETE FROM auth_sessions WHERE user_id = ?")) {
      const [userId] = args as [string];
      this.authSessions.delete(userId);
      return;
    }
    if (sql.includes("DELETE FROM auth_refresh_sessions WHERE user_id = ?")) {
      const [userId] = args as [string];
      this.refreshSessions.delete(userId);
      return;
    }
    if (sql.includes("DELETE FROM user_github_credentials WHERE user_id = ?")) {
      const [userId] = args as [string];
      this.credentials.delete(userId);
      return;
    }
    if (sql.includes("DELETE FROM auth_sessions WHERE user_id IN")) {
      const [githubId] = args as [number];
      for (const [userId, user] of this.users) {
        if (user.github_id === githubId) {
          this.authSessions.delete(userId);
        }
      }
      return;
    }
    if (sql.includes("DELETE FROM auth_refresh_sessions WHERE user_id IN")) {
      const [githubId] = args as [number];
      for (const [userId, user] of this.users) {
        if (user.github_id === githubId) {
          this.refreshSessions.delete(userId);
        }
      }
      return;
    }
    if (sql.includes("DELETE FROM user_github_credentials WHERE user_id IN")) {
      const [githubId] = args as [number];
      for (const [userId, user] of this.users) {
        if (user.github_id === githubId) {
          this.credentials.delete(userId);
        }
      }
      return;
    }
    throw new Error(`MockD1: unhandled SQL: ${sql}`);
  }
}

describe("UserSessionRepository session revocation", () => {
  it("revokes web sessions, native refresh families, and credentials by user id", async () => {
    const db = new MockD1();
    db.seedUser("user-1", 123);

    await new UserSessionRepository(db.asD1()).revokeAllSessionsForUser("user-1");

    expect(db.authSessions.has("user-1")).toBe(false);
    expect(db.refreshSessions.has("user-1")).toBe(false);
    expect(db.credentials.has("user-1")).toBe(false);
  });

  it("revokes web sessions, native refresh families, and credentials by GitHub id", async () => {
    const db = new MockD1();
    db.seedUser("user-1", 123);
    db.seedUser("user-2", 456);

    await new UserSessionRepository(db.asD1()).revokeAllSessionsByGithubId(123);

    expect(db.authSessions.has("user-1")).toBe(false);
    expect(db.refreshSessions.has("user-1")).toBe(false);
    expect(db.credentials.has("user-1")).toBe(false);
    expect(db.authSessions.has("user-2")).toBe(true);
    expect(db.refreshSessions.has("user-2")).toBe(true);
    expect(db.credentials.has("user-2")).toBe(true);
  });
});
