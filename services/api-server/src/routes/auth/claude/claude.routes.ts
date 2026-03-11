import { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "@/types";
import { encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  authMiddleware,
  type AuthUser,
} from "@/middleware/auth.middleware";
import { ClaudeSessionRepository } from "@/repositories/claude-session-repository";
import {
  getClaudeAuthRoute,
  postClaudeTokenRoute,
  getClaudeStatusRoute,
  postClaudeDisconnectRoute,
} from "./schemas";
import { generateCodeVerifier, computeCodeChallenge } from "@/lib/pkce";

const DEFAULT_CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const DEFAULT_CLAUDE_AUTH_URL = "https://claude.ai/oauth/authorize";
const DEFAULT_CLAUDE_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const DEFAULT_CLAUDE_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const DEFAULT_CLAUDE_SCOPES = [
  "org:create_api_key",
  "user:inference",
  "user:mcp_servers",
  "user:profile",
  "user:sessions:claude_code",
];

type ClaudeCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscriptionType: string | null;
  rateLimitTier: string | null;
};

function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((scope): scope is string => typeof scope === "string");
  }
  if (typeof value === "string") {
    return value.split(" ").map((scope) => scope.trim()).filter(Boolean);
  }
  return [];
}

function parseClaudeTokenResponse(payload: unknown): ClaudeCredentials {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid Claude token payload");
  }
  const raw = payload as Record<string, unknown>;
  const accessToken = raw.access_token;
  const refreshToken = raw.refresh_token;
  const expiresIn = raw.expires_in;
  const subscriptionType = raw.subscription_type;
  const rateLimitTier = raw.rate_limit_tier;

  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn)
  ) {
    throw new Error("Claude token response missing required fields");
  }

  const expiresAt = Date.now() + expiresIn * 1000;
  const scopes = parseScopes(raw.scope);

  return {
    accessToken,
    refreshToken,
    expiresAt,
    scopes: scopes.length > 0 ? scopes : DEFAULT_CLAUDE_SCOPES,
    subscriptionType: typeof subscriptionType === "string" ? subscriptionType : null,
    rateLimitTier: typeof rateLimitTier === "string" ? rateLimitTier : null,
  };
}

export const claudeAuthRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();

claudeAuthRoutes.openapi(getClaudeAuthRoute, async (c) => {
  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await computeCodeChallenge(codeVerifier);
  const claudeSessionRepository = new ClaudeSessionRepository(c.env.DB);

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await claudeSessionRepository.createOauthState(state, expiresAt, codeVerifier);

  const clientId = c.env.CLAUDE_OAUTH_CLIENT_ID ?? DEFAULT_CLAUDE_CLIENT_ID;
  const authorizeUrl = c.env.CLAUDE_OAUTH_AUTH_URL ?? DEFAULT_CLAUDE_AUTH_URL;
  const redirectUri = c.env.CLAUDE_OAUTH_REDIRECT_URI ?? DEFAULT_CLAUDE_REDIRECT_URI;

  const params = new URLSearchParams({
    code: "true", // required, regular redirect uri doesn't work 
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: DEFAULT_CLAUDE_SCOPES.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  return c.json({ url: `${authorizeUrl}?${params.toString()}`, state }, 200);
});

claudeAuthRoutes.use("/claude/token", authMiddleware);
claudeAuthRoutes.openapi(postClaudeTokenRoute, async (c) => {
  const { code, state } = c.req.valid("json");
  const user = c.get("user");
  const claudeSessionRepository = new ClaudeSessionRepository(c.env.DB);

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  // Some manual flows return "code#state". Support that format while
  // enforcing CSRF state consistency with the request payload.
  const [rawCodePart, rawStatePart] = code.split("#");
  const authorizationCode = rawCodePart?.trim() ?? "";
  const pastedState = rawStatePart?.trim();
  if (!authorizationCode) {
    return c.json({ error: "Missing authorization code" }, 400);
  }
  if (pastedState && pastedState !== state) {
    return c.json({ error: "State mismatch in pasted code" }, 400);
  }

  const stateRow = await claudeSessionRepository.consumeOauthState(state);
  if (!stateRow) {
    return c.json({ error: "Invalid or expired state" }, 400);
  }

  const clientId = c.env.CLAUDE_OAUTH_CLIENT_ID ?? DEFAULT_CLAUDE_CLIENT_ID;
  const tokenUrl = c.env.CLAUDE_OAUTH_TOKEN_URL ?? DEFAULT_CLAUDE_TOKEN_URL;
  const redirectUri = c.env.CLAUDE_OAUTH_REDIRECT_URI ?? DEFAULT_CLAUDE_REDIRECT_URI;

  let credentials: ClaudeCredentials;
  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: authorizationCode,
        state,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: stateRow.codeVerifier,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Claude token exchange failed: ${errorText}`);
      return c.json({ error: "Failed to exchange code" }, 400);
    }

    const tokenPayload = await response.json();
    credentials = parseClaudeTokenResponse(tokenPayload);
  } catch (error) {
    logger.error("Claude token exchange error", { error });
    return c.json({ error: "Failed to exchange code" }, 400);
  }

  const encryptedAccess = await encrypt(
    credentials.accessToken,
    c.env.TOKEN_ENCRYPTION_KEY,
  );
  const encryptedRefresh = await encrypt(
    credentials.refreshToken,
    c.env.TOKEN_ENCRYPTION_KEY,
  );

  await claudeSessionRepository.upsertClaudeSession({
    userId: user.id,
    encryptedAccessToken: encryptedAccess,
    encryptedRefreshToken: encryptedRefresh,
    expiresAtMs: credentials.expiresAt,
    scopesJson: JSON.stringify(credentials.scopes),
    subscriptionType: credentials.subscriptionType,
    rateLimitTier: credentials.rateLimitTier,
  });

  return c.json({ ok: true as const }, 200);
});

claudeAuthRoutes.use("/claude/status", authMiddleware);
claudeAuthRoutes.openapi(getClaudeStatusRoute, async (c) => {
  const user = c.get("user");
  const claudeSessionRepository = new ClaudeSessionRepository(c.env.DB);
  const row = await claudeSessionRepository.getConnectionStatus(user.id);

  if (!row) {
    return c.json(
      {
        connected: false,
        subscriptionType: null,
        rateLimitTier: null,
      },
      200,
    );
  }

  return c.json(
    {
      connected: true,
      subscriptionType: row.subscriptionType,
      rateLimitTier: row.rateLimitTier,
    },
    200,
  );
});

claudeAuthRoutes.use("/claude/disconnect", authMiddleware);
claudeAuthRoutes.openapi(postClaudeDisconnectRoute, async (c) => {
  const user = c.get("user");
  const claudeSessionRepository = new ClaudeSessionRepository(c.env.DB);
  await claudeSessionRepository.deleteByUserId(user.id);
  return c.json({ ok: true as const }, 200);
});
