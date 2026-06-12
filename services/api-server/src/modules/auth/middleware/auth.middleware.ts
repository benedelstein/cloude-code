import { createMiddleware } from "hono/factory";
import type { Env } from "@/shared/types";
import { UserSessionService } from "../services/user-session.service";
import {
  looksLikeJwt,
  NativeAccessTokenService,
} from "../services/native-access-token.service";
import type { AuthContext } from "../types/auth.types";

type AuthEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext };
};

export type AuthenticateSession = (
  env: Env,
  token: string,
) => Promise<AuthContext | null>;

const authenticateSession: AuthenticateSession = (env, token) =>
  authenticateBearerToken(env, token);

export async function authenticateBearerToken(
  env: Env,
  token: string,
  authenticateOpaqueSession: AuthenticateSession = (sessionEnv, sessionToken) =>
    new UserSessionService(sessionEnv).getAuthenticatedUserIdBySessionToken(
      sessionToken,
    ),
): Promise<AuthContext | null> {
  if (looksLikeJwt(token)) {
    const identity = await new NativeAccessTokenService(env).verify(token);
    if (!identity) {
      return null;
    }
    return { userId: identity.userId };
  }

  return await authenticateOpaqueSession(env, token);
}

export function createAuthMiddleware(
  authenticate: AuthenticateSession = authenticateSession,
) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.slice(7);
    const auth = await authenticate(c.env, token);
    if (!auth) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("auth", auth);

    await next();
  });
}

export const authMiddleware = createAuthMiddleware();
export type { AuthContext };
