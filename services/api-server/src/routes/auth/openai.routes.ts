import { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { Env } from "@/types";
import { encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  authMiddleware,
  type AuthUser,
} from "@/middleware/auth.middleware";
import {
  OpenAIAuthUrlResponse,
  OpenAITokenRequest,
  OpenAITokenResponse,
  OpenAIStatusResponse,
  OpenAIDisconnectResponse,
} from "@repo/shared";
import { generateCodeVerifier, computeCodeChallenge } from "@/lib/pkce";

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_AUTH_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_SCOPES = "openid profile email offline_access";

const ErrorResponse = z.object({
  error: z.string(),
});

/** Decode JWT payload without signature verification (for expiry tracking only). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");
  const payload = parts[1]!
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return JSON.parse(atob(payload));
}

// --- Route definitions ---

const getOpenAIAuthRoute = createRoute({
  method: "get",
  path: "/openai",
  responses: {
    200: {
      content: { "application/json": { schema: OpenAIAuthUrlResponse } },
      description: "OpenAI OAuth authorization URL with PKCE",
    },
  },
});

const postOpenAITokenRoute = createRoute({
  method: "post",
  path: "/openai/token",
  middleware: [authMiddleware] as const,
  request: {
    body: {
      content: { "application/json": { schema: OpenAITokenRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: OpenAITokenResponse } },
      description: "Token exchange success",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Bad request",
    },
  },
});

const getOpenAIStatusRoute = createRoute({
  method: "get",
  path: "/openai/status",
  middleware: [authMiddleware] as const,
  responses: {
    200: {
      content: { "application/json": { schema: OpenAIStatusResponse } },
      description: "OpenAI connection status",
    },
  },
});

const postOpenAIDisconnectRoute = createRoute({
  method: "post",
  path: "/openai/disconnect",
  middleware: [authMiddleware] as const,
  responses: {
    200: {
      content: { "application/json": { schema: OpenAIDisconnectResponse } },
      description: "Disconnect success",
    },
  },
});

// --- Router ---

export const openaiAuthRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();

/**
 * GET /auth/openai — Generate OpenAI OAuth URL with PKCE
 * The redirect_uri query param tells us where to send the user back.
 */
openaiAuthRoutes.openapi(getOpenAIAuthRoute, async (c) => {
  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await computeCodeChallenge(codeVerifier);

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO oauth_states (state, expires_at, code_verifier) VALUES (?, ?, ?)`,
  )
    .bind(state, expiresAt, codeVerifier)
    .run();

  // redirect_uri must be a localhost URL — OpenAI's OAuth client only allows
  // localhost redirects for the Codex CLI public client.
  const redirectUri =
    c.req.query("redirect_uri") ??
    "http://localhost:1455/auth/callback";

  // Build the query string manually — URLSearchParams encodes spaces as "+"
  // but OpenAI's auth server expects "%20" encoding for the scope parameter.
  const queryParts = [
    `client_id=${encodeURIComponent(OPENAI_CLIENT_ID)}`,
    `response_type=code`,
    `redirect_uri=${encodeURIComponent(redirectUri)}`,
    `code_challenge=${encodeURIComponent(codeChallenge)}`,
    `code_challenge_method=S256`,
    `state=${encodeURIComponent(state)}`,
    `scope=${encodeURIComponent(OPENAI_SCOPES)}`,
    `id_token_add_organizations=true`,
    `codex_cli_simplified_flow=true`,
    `originator=codex_cli_rs`,
  ];

  const url = `${OPENAI_AUTH_URL}?${queryParts.join("&")}`;
  console.log(`OpenAI OAuth URL: ${url}`);

  return c.json({ url, state }, 200);
});

/**
 * POST /auth/openai/token — Exchange authorization code for tokens
 * Requires authentication (user must be logged in via GitHub first).
 */
openaiAuthRoutes.openapi(postOpenAITokenRoute, async (c) => {
  const { code, state } = c.req.valid("json");
  const user = c.get("user");

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  // Validate and consume state, retrieve code_verifier
  const stateRow = await c.env.DB.prepare(
    `DELETE FROM oauth_states WHERE state = ? AND datetime(expires_at) > datetime('now') RETURNING state, code_verifier`,
  )
    .bind(state)
    .first<{ state: string; code_verifier: string }>();

  if (!stateRow?.code_verifier) {
    return c.json({ error: "Invalid or expired state" }, 400);
  }

  // Must match the redirect_uri used in the authorize request
  const redirectUri =
    c.req.query("redirect_uri") ??
    "http://localhost:1455/auth/callback";

  // Exchange code for tokens at OpenAI
  let tokenData: {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
  };

  try {
    const response = await fetch(OPENAI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: OPENAI_CLIENT_ID,
        code_verifier: stateRow.code_verifier,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`OpenAI token exchange failed: ${errorText}`);
      return c.json({ error: "Failed to exchange code" }, 400);
    }

    tokenData = await response.json();
  } catch (error) {
    logger.error("OpenAI token exchange error", { error });
    return c.json({ error: "Failed to exchange code" }, 400);
  }

  // Encrypt tokens before storing
  const encryptedAccess = await encrypt(
    tokenData.access_token,
    c.env.TOKEN_ENCRYPTION_KEY,
  );
  const encryptedRefresh = tokenData.refresh_token
    ? await encrypt(tokenData.refresh_token, c.env.TOKEN_ENCRYPTION_KEY)
    : null;
  const encryptedIdToken = tokenData.id_token
    ? await encrypt(tokenData.id_token, c.env.TOKEN_ENCRYPTION_KEY)
    : null;

  // Extract expiry from access token JWT
  let tokenExpiresAt: string | null = null;
  try {
    const payload = decodeJwtPayload(tokenData.access_token);
    if (typeof payload.exp === "number") {
      tokenExpiresAt = new Date(payload.exp * 1000).toISOString();
    }
  } catch {
    // Non-critical — we just won't track expiry
  }

  // Upsert into openai_tokens
  await c.env.DB.prepare(
    `INSERT INTO openai_tokens (user_id, encrypted_access_token, encrypted_refresh_token, encrypted_id_token, token_expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       encrypted_access_token = excluded.encrypted_access_token,
       encrypted_refresh_token = excluded.encrypted_refresh_token,
       encrypted_id_token = excluded.encrypted_id_token,
       token_expires_at = excluded.token_expires_at,
       updated_at = datetime('now')`,
  )
    .bind(user.id, encryptedAccess, encryptedRefresh, encryptedIdToken, tokenExpiresAt)
    .run();

  return c.json({ ok: true as const }, 200);
});

/**
 * GET /auth/openai/status — Check if user has connected OpenAI
 */
openaiAuthRoutes.openapi(getOpenAIStatusRoute, async (c) => {
  const user = c.get("user");

  const row = await c.env.DB.prepare(
    `SELECT user_id FROM openai_tokens WHERE user_id = ?`,
  )
    .bind(user.id)
    .first();

  return c.json({ connected: !!row }, 200);
});

/**
 * POST /auth/openai/disconnect — Remove OpenAI tokens
 */
openaiAuthRoutes.openapi(postOpenAIDisconnectRoute, async (c) => {
  const user = c.get("user");

  await c.env.DB.prepare(`DELETE FROM openai_tokens WHERE user_id = ?`)
    .bind(user.id)
    .run();

  return c.json({ ok: true as const }, 200);
});
