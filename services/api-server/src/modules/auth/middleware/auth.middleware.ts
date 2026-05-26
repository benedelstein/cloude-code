import { createMiddleware } from "hono/factory";
import type { Env } from "@/shared/types";
import { UserSessionService } from "../services/user-session.service";
import type { AuthUser } from "../auth.types";

type AuthEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

export type AuthenticateSession = (
  env: Env,
  token: string,
) => Promise<AuthUser | null>;

const authenticateSession: AuthenticateSession = (env, token) =>
  new UserSessionService(env).getAuthenticatedUserBySessionToken(token);

export function createAuthMiddleware(
  authenticate: AuthenticateSession = authenticateSession,
) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.slice(7);
    const user = await authenticate(c.env, token);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("user", user);

    await next();
  });
}

export const authMiddleware = createAuthMiddleware();
export type { AuthUser };
