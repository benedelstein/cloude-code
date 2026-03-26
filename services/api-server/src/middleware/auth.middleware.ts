import { createMiddleware } from "hono/factory";
import type { Env } from "@/types";
import { UserSessionService } from "@/lib/user-session/user-session.service";

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
  const userSessionService = new UserSessionService(c.env);
  const user = await userSessionService.getAuthenticatedUserBySessionToken(token);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("user", user);

  await next();
});
