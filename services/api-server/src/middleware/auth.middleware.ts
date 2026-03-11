import { createMiddleware } from "hono/factory";
import type { Env } from "@/types";
import { decrypt, encrypt } from "@/lib/crypto";
import { GitHubAppService } from "@/lib/github";
import { logger } from "@/lib/logger";
import { UserSessionRepository } from "@/repositories/user-session-repository";

export interface AuthUser {
  id: string;
  githubId: number;
  githubLogin: string;
  githubName: string | null;
  githubAvatarUrl: string | null;
  githubAccessToken: string; // decrypted
}

type AuthEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  const userSessionRepository = new UserSessionRepository(c.env.DB);

  const row = await userSessionRepository.getActiveAuthSessionByToken(token);

  if (!row) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let accessToken = await decrypt(
    row.githubAccessToken,
    c.env.TOKEN_ENCRYPTION_KEY,
  );

  // Refresh if GitHub token is expired
  // TODO: is it appropriate to internally refresh here?
  if (row.tokenExpiresAt && new Date(row.tokenExpiresAt) < new Date()) {
    const encryptedRefreshToken = await userSessionRepository.getRefreshTokenByUserId(
      row.id,
    );

    if (!encryptedRefreshToken) {
      return c.json({ error: "Token expired and no refresh token" }, 401);
    }

    try {
      const github = new GitHubAppService(c.env, logger);
      const decryptedRefresh = await decrypt(
        encryptedRefreshToken,
        c.env.TOKEN_ENCRYPTION_KEY,
      );
      const refreshed = await github.refreshUserToken(decryptedRefresh);

      const encryptedAccess = await encrypt(
        refreshed.accessToken,
        c.env.TOKEN_ENCRYPTION_KEY,
      );
      const encryptedRefresh = await encrypt(
        refreshed.refreshToken,
        c.env.TOKEN_ENCRYPTION_KEY,
      );

      await userSessionRepository.updateSessionAccessToken(
        row.sessionToken,
        encryptedAccess,
        refreshed.expiresAt,
      );

      await userSessionRepository.updateRefreshToken(
        row.id,
        encryptedRefresh,
        refreshed.refreshTokenExpiresAt ?? null,
      );

      accessToken = refreshed.accessToken;
    } catch {
      return c.json({ error: "Token refresh failed" }, 401);
    }
  }

  c.set("user", {
    id: row.id,
    githubId: row.githubId,
    githubLogin: row.githubLogin,
    githubName: row.githubName,
    githubAvatarUrl: row.githubAvatarUrl,
    githubAccessToken: accessToken,
  });

  await next();
});
