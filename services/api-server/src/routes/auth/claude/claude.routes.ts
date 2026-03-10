import { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "@/types";
import { encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  authMiddleware,
  type AuthUser,
} from "@/middleware/auth.middleware";
import {
  getClaudeAuthRoute,
  postClaudeTokenRoute,
  getClaudeStatusRoute,
  postClaudeDisconnectRoute,
} from "./schemas";

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

function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function computeCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

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
  const nested = raw.claudeAiOauth as Record<string, unknown> | undefined;

  const accessToken = (
    nested?.accessToken ??
    raw.access_token ??
    raw.accessToken
  );
  const refreshToken = (
    nested?.refreshToken ??
    raw.refresh_token ??
    raw.refreshToken
  );
  const expiresAtRaw = (
    nested?.expiresAt ??
    raw.expiresAt ??
    raw.expires_at_ms
  );
  const expiresIn = raw.expires_in;

  let expiresAt: number | null = null;
  if (typeof expiresAtRaw === "number" && Number.isFinite(expiresAtRaw)) {
    expiresAt = expiresAtRaw;
  } else if (typeof expiresAtRaw === "string" && Number.isFinite(Number(expiresAtRaw))) {
    expiresAt = Number(expiresAtRaw);
  } else if (typeof expiresIn === "number" && Number.isFinite(expiresIn)) {
    expiresAt = Date.now() + expiresIn * 1000;
  }

  const scopes = parseScopes(
    nested?.scopes ??
      raw.scope ??
      raw.scopes,
  );
  const subscriptionType =
    (nested?.subscriptionType ?? raw.subscription_type ?? raw.subscriptionType) as
      | string
      | undefined;
  const rateLimitTier =
    (nested?.rateLimitTier ?? raw.rate_limit_tier ?? raw.rateLimitTier) as
      | string
      | undefined;

  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    !expiresAt
  ) {
    throw new Error("Claude token response missing required fields");
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    scopes: scopes.length > 0 ? scopes : DEFAULT_CLAUDE_SCOPES,
    subscriptionType: subscriptionType ?? null,
    rateLimitTier: rateLimitTier ?? null,
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

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO oauth_states (state, expires_at, code_verifier) VALUES (?, ?, ?)`,
  )
    .bind(state, expiresAt, codeVerifier)
    .run();

  const clientId = c.env.CLAUDE_OAUTH_CLIENT_ID ?? DEFAULT_CLAUDE_CLIENT_ID;
  const authorizeUrl = c.env.CLAUDE_OAUTH_AUTH_URL ?? DEFAULT_CLAUDE_AUTH_URL;
  const redirectUri = c.env.CLAUDE_OAUTH_REDIRECT_URI ?? DEFAULT_CLAUDE_REDIRECT_URI;

  const params = new URLSearchParams({
    code: "true",
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

  const stateRow = await c.env.DB.prepare(
    `DELETE FROM oauth_states WHERE state = ? AND datetime(expires_at) > datetime('now') RETURNING state, code_verifier`,
  )
    .bind(state)
    .first<{ state: string; code_verifier: string }>();

  if (!stateRow?.code_verifier) {
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
        code_verifier: stateRow.code_verifier,
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

  await c.env.DB.prepare(
    `INSERT INTO claude_tokens (
       user_id,
       encrypted_access_token,
       encrypted_refresh_token,
       expires_at_ms,
       scopes_json,
       subscription_type,
       rate_limit_tier
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       encrypted_access_token = excluded.encrypted_access_token,
       encrypted_refresh_token = excluded.encrypted_refresh_token,
       expires_at_ms = excluded.expires_at_ms,
       scopes_json = excluded.scopes_json,
       subscription_type = excluded.subscription_type,
       rate_limit_tier = excluded.rate_limit_tier,
       updated_at = datetime('now')`,
  )
    .bind(
      user.id,
      encryptedAccess,
      encryptedRefresh,
      credentials.expiresAt,
      JSON.stringify(credentials.scopes),
      credentials.subscriptionType,
      credentials.rateLimitTier,
    )
    .run();

  return c.json({ ok: true as const }, 200);
});

claudeAuthRoutes.use("/claude/status", authMiddleware);
claudeAuthRoutes.openapi(getClaudeStatusRoute, async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    `SELECT subscription_type, rate_limit_tier FROM claude_tokens WHERE user_id = ?`,
  )
    .bind(user.id)
    .first<{
      subscription_type: string | null;
      rate_limit_tier: string | null;
    }>();

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
      subscriptionType: row.subscription_type ?? null,
      rateLimitTier: row.rate_limit_tier ?? null,
    },
    200,
  );
});

claudeAuthRoutes.use("/claude/disconnect", authMiddleware);
claudeAuthRoutes.openapi(postClaudeDisconnectRoute, async (c) => {
  const user = c.get("user");
  await c.env.DB.prepare(`DELETE FROM claude_tokens WHERE user_id = ?`)
    .bind(user.id)
    .run();
  return c.json({ ok: true as const }, 200);
});
