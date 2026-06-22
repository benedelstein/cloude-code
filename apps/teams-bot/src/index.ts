import { IntegrationSessionResponse } from "@repo/shared";
import { z } from "zod";

interface Env {
  API_BASE_URL: string;
  INTEGRATION_SESSION_REQUEST_TOKEN: string;
  MICROSOFT_APP_ID: string;
  MICROSOFT_APP_PASSWORD: string;
  MICROSOFT_APP_TENANT_ID?: string;
}

interface BotTokenCacheEntry {
  accessToken: string;
  expiresAtMs: number;
}

interface JwksCacheEntry {
  keys: JwkKey[];
  expiresAtMs: number;
}

const TeamsActivitySchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  serviceUrl: z.string().url(),
  channelId: z.string().optional(),
  text: z.string().optional(),
  from: z.object({
    id: z.string(),
    name: z.string().optional(),
    aadObjectId: z.string().optional(),
  }),
  recipient: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
  conversation: z.object({
    id: z.string(),
    tenantId: z.string().optional(),
  }),
  channelData: z.object({
    team: z.object({ id: z.string().optional() }).optional(),
    tenant: z.object({ id: z.string().optional() }).optional(),
  }).optional(),
});

const TokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
});

const OpenIdConfigSchema = z.object({ jwks_uri: z.string().url() });
const JwkKeySchema = z.object({
  kid: z.string().optional(),
  x5t: z.string().optional(),
  kty: z.literal("RSA"),
  n: z.string(),
  e: z.string(),
  endorsements: z.array(z.string()).optional(),
});
const JwksSchema = z.object({ keys: z.array(JwkKeySchema) });

type TeamsActivity = z.infer<typeof TeamsActivitySchema>;
type JwkKey = z.infer<typeof JwkKeySchema>;

const BOT_FRAMEWORK_OPEN_ID_CONFIG_URL = "https://login.botframework.com/v1/.well-known/openidconfiguration";
const BOT_FRAMEWORK_TOKEN_SCOPE = "https://api.botframework.com/.default";
const BOT_FRAMEWORK_ISSUER = "https://api.botframework.com";
const DEFAULT_TENANT_ID = "botframework.com";
const MAX_TEAMS_MESSAGE_LENGTH = 3000;
const JWT_CLOCK_SKEW_SECONDS = 300;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

let botTokenCache: BotTokenCacheEntry | null = null;
let jwksCache: JwksCacheEntry | null = null;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const body = await request.text();
    const isVerified = await verifyBotFrameworkRequest(request, body, env.MICROSOFT_APP_ID);
    if (!isVerified) {
      return new Response("invalid request token", { status: 401 });
    }

    const activity = parseTeamsActivity(body);
    if (!activity) {
      return new Response(null, { status: 400 });
    }

    if (activity.type !== "message") {
      return new Response(null, { status: 202 });
    }

    const prompt = getPrompt(activity);
    if (!prompt) {
      ctx.waitUntil(replyToActivity(env, activity, "Use `@Cloude <what to change, including the repo hint>` to create a session."));
      return new Response(null, { status: 202 });
    }

    ctx.waitUntil(handleSessionRequest({ env, activity, prompt }));
    return new Response(null, { status: 202 });
  },
};

async function handleSessionRequest(params: {
  env: Env;
  activity: TeamsActivity;
  prompt: string;
}): Promise<void> {
  await replyToActivity(params.env, params.activity, "Creating a Cloude session...");

  const message = await createSession(params);
  await sendToConversation(params.env, params.activity, message);
}

async function createSession(params: {
  env: Env;
  activity: TeamsActivity;
  prompt: string;
}): Promise<string> {
  try {
    const response = await fetch(`${params.env.API_BASE_URL.replace(/\/$/, "")}/integrations/session-requests`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${params.env.INTEGRATION_SESSION_REQUEST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        externalUser: {
          provider: "teams",
          id: params.activity.from.aadObjectId ?? params.activity.from.id,
          displayName: params.activity.from.name,
          tenantId: params.activity.channelData?.tenant?.id ?? params.activity.conversation.tenantId,
          teamId: params.activity.channelData?.team?.id,
        },
        prompt: params.prompt,
      }),
    });
    return buildTeamsMessage(response);
  } catch {
    return "I could not create a Cloude session. Something went wrong, please try again.";
  }
}

async function buildTeamsMessage(response: Response): Promise<string> {
  if (!response.ok) {
    return "I could not create a Cloude session. The API rejected the request.";
  }

  const parsed = IntegrationSessionResponse.safeParse(await response.json());
  if (!parsed.success) {
    return "I could not create a Cloude session. The API returned an unexpected response.";
  }

  if (!parsed.data.ok) {
    if (parsed.data.linkUrl) {
      const expires = parsed.data.linkExpiresAt
        ? ` This link expires at ${new Date(parsed.data.linkExpiresAt).toLocaleString()}.`
        : "";
      return truncateTeamsMessage(`${parsed.data.message} ${parsed.data.linkUrl}${expires}`);
    }

    const candidates = parsed.data.candidates?.map((candidate) => `- ${candidate.repoFullName}`).join("\n");
    return truncateTeamsMessage([
      `I could not create a session: ${parsed.data.message}`,
      candidates ? `\nPossible repos:\n${candidates}` : "",
    ].join(""));
  }

  const title = parsed.data.title ? ` (${parsed.data.title})` : "";
  const link = parsed.data.sessionUrl ? `\n${parsed.data.sessionUrl}` : "";
  const reason = parsed.data.routingReason ? `\nRouting: ${parsed.data.routingReason}` : "";
  return truncateTeamsMessage(`Started a Cloude session in ${parsed.data.repoFullName}${title}.${link}${reason}`);
}

async function replyToActivity(env: Env, activity: TeamsActivity, text: string): Promise<void> {
  if (!activity.id) {
    await sendToConversation(env, activity, text);
    return;
  }

  await postBotActivity({
    env,
    activity,
    url: `${activity.serviceUrl.replace(/\/$/, "")}/v3/conversations/${encodeURIComponent(
      activity.conversation.id,
    )}/activities/${encodeURIComponent(activity.id)}`,
    text,
  });
}

async function sendToConversation(env: Env, activity: TeamsActivity, text: string): Promise<void> {
  await postBotActivity({
    env,
    activity,
    url: `${activity.serviceUrl.replace(/\/$/, "")}/v3/conversations/${encodeURIComponent(
      activity.conversation.id,
    )}/activities`,
    text,
  });
}

async function postBotActivity(params: {
  env: Env;
  activity: TeamsActivity;
  url: string;
  text: string;
}): Promise<void> {
  const token = await getBotConnectorToken(params.env);
  await fetch(params.url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "message",
      from: params.activity.recipient,
      recipient: params.activity.from,
      conversation: params.activity.conversation,
      replyToId: params.activity.id,
      text: params.text,
    }),
  });
}

async function getBotConnectorToken(env: Env): Promise<string> {
  const now = Date.now();
  if (botTokenCache && botTokenCache.expiresAtMs - now > 60_000) {
    return botTokenCache.accessToken;
  }

  const tenantId = env.MICROSOFT_APP_TENANT_ID ?? DEFAULT_TENANT_ID;
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.MICROSOFT_APP_ID,
      client_secret: env.MICROSOFT_APP_PASSWORD,
      scope: BOT_FRAMEWORK_TOKEN_SCOPE,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to request Bot Framework token");
  }

  const parsed = TokenResponseSchema.parse(await response.json());
  botTokenCache = {
    accessToken: parsed.access_token,
    expiresAtMs: now + parsed.expires_in * 1000,
  };
  return botTokenCache.accessToken;
}

function parseTeamsActivity(body: string): TeamsActivity | null {
  try {
    const parsed = TeamsActivitySchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function getPrompt(activity: TeamsActivity): string | null {
  const text = normalizeTeamsText(activity.text ?? "");
  return text.trim() ? text.trim() : null;
}

function normalizeTeamsText(value: string): string {
  return value
    .replace(/<at>.*?<\/at>/giu, "")
    .replace(/<[^>]+>/gu, "")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .trim();
}

async function verifyBotFrameworkRequest(request: Request, body: string, appId: string): Promise<boolean> {
  const token = getBearerToken(request.headers.get("Authorization"));
  if (!token) {
    return false;
  }

  const parsed = parseJwt(token);
  if (!parsed || parsed.header.alg !== "RS256") {
    return false;
  }

  const key = await getSigningKey(parsed.header.kid ?? parsed.header.x5t);
  if (!key) {
    return false;
  }

  const isSignatureValid = await verifyJwtSignature({ token, key });
  if (!isSignatureValid) {
    return false;
  }

  return isBotFrameworkClaimsValid({ claims: parsed.payload, appId, body });
}

function getBearerToken(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const [scheme, token] = value.trim().split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function parseJwt(token: string): {
  header: JwtHeader;
  payload: JwtPayload;
  signedContent: string;
  signature: Uint8Array;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  try {
    const header = JwtHeaderSchema.parse(JSON.parse(base64UrlDecodeToString(encodedHeader)));
    const payload = JwtPayloadSchema.parse(JSON.parse(base64UrlDecodeToString(encodedPayload)));
    return {
      header,
      payload,
      signedContent: `${encodedHeader}.${encodedPayload}`,
      signature: base64UrlToBytes(encodedSignature),
    };
  } catch {
    return null;
  }
}

const JwtHeaderSchema = z.object({
  alg: z.string(),
  kid: z.string().optional(),
  x5t: z.string().optional(),
});

const JwtPayloadSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
  nbf: z.number().optional(),
  serviceurl: z.string().optional(),
  appid: z.string().optional(),
  azp: z.string().optional(),
});

type JwtHeader = z.infer<typeof JwtHeaderSchema>;
type JwtPayload = z.infer<typeof JwtPayloadSchema>;

async function getSigningKey(keyId: string | undefined): Promise<JwkKey | null> {
  if (!keyId) {
    return null;
  }

  const keys = await getSigningKeys();
  return keys.find((key) => key.kid === keyId || key.x5t === keyId) ?? null;
}

async function getSigningKeys(): Promise<JwkKey[]> {
  const now = Date.now();
  if (jwksCache && jwksCache.expiresAtMs > now) {
    return jwksCache.keys;
  }

  const configResponse = await fetch(BOT_FRAMEWORK_OPEN_ID_CONFIG_URL);
  const config = OpenIdConfigSchema.parse(await configResponse.json());
  const jwksResponse = await fetch(config.jwks_uri);
  const jwks = JwksSchema.parse(await jwksResponse.json());
  jwksCache = { keys: jwks.keys, expiresAtMs: now + JWKS_CACHE_TTL_MS };
  return jwksCache.keys;
}

async function verifyJwtSignature(params: { token: string; key: JwkKey }): Promise<boolean> {
  const parsed = parseJwt(params.token);
  if (!parsed) {
    return false;
  }

  try {
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      { kty: params.key.kty, n: params.key.n, e: params.key.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      parsed.signature,
      new TextEncoder().encode(parsed.signedContent),
    );
  } catch {
    return false;
  }
}

function isBotFrameworkClaimsValid(params: { claims: JwtPayload; appId: string; body: string }): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (params.claims.iss !== BOT_FRAMEWORK_ISSUER) {
    return false;
  }
  if (params.claims.aud !== params.appId) {
    return false;
  }
  if (params.claims.exp + JWT_CLOCK_SKEW_SECONDS < nowSeconds) {
    return false;
  }
  if (params.claims.nbf && params.claims.nbf - JWT_CLOCK_SKEW_SECONDS > nowSeconds) {
    return false;
  }

  const activity = parseTeamsActivity(params.body);
  if (!activity || !params.claims.serviceurl) {
    return true;
  }
  return activity.serviceUrl.toLowerCase() === params.claims.serviceurl.toLowerCase();
}

function base64UrlDecodeToString(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function truncateTeamsMessage(value: string): string {
  return value.length <= MAX_TEAMS_MESSAGE_LENGTH ? value : `${value.slice(0, MAX_TEAMS_MESSAGE_LENGTH - 3)}...`;
}
