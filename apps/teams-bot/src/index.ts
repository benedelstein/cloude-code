import { IntegrationSessionResponse } from "@repo/shared";
import { z } from "zod";

interface Env {
  API_BASE_URL: string;
  INTEGRATION_SESSION_REQUEST_TOKEN: string;
  TEAMS_OUTGOING_WEBHOOK_SECRET: string;
}

const TeamsActivitySchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  from: z.object({
    id: z.string(),
    name: z.string().optional(),
    aadObjectId: z.string().optional(),
  }),
  conversation: z.object({
    tenantId: z.string().optional(),
  }).optional(),
  channelData: z.object({
    team: z.object({ id: z.string().optional() }).optional(),
    tenant: z.object({ id: z.string().optional() }).optional(),
  }).optional(),
});

type TeamsActivity = z.infer<typeof TeamsActivitySchema>;

const MAX_TEAMS_MESSAGE_LENGTH = 3000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const body = await request.text();
    const isVerified = await verifyTeamsRequest(request, body, env.TEAMS_OUTGOING_WEBHOOK_SECRET);
    if (!isVerified) {
      return new Response("invalid request signature", { status: 401 });
    }

    const activity = parseTeamsActivity(body);
    if (!activity) {
      return teamsMessageResponse("Invalid Teams activity payload.");
    }

    if (activity.type !== "message") {
      return teamsMessageResponse("Unsupported Teams activity type.");
    }

    const prompt = getPrompt(activity);
    if (!prompt) {
      return teamsMessageResponse("Use `@Cloude <what to change, including the repo hint>` to create a session.");
    }

    const response = await createSession({ env, activity, prompt });
    return teamsMessageResponse(response);
  },
};

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
          tenantId: params.activity.channelData?.tenant?.id ?? params.activity.conversation?.tenantId,
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

async function verifyTeamsRequest(request: Request, body: string, secret: string): Promise<boolean> {
  const authorization = request.headers.get("Authorization");
  const providedSignature = parseHmacAuthorization(authorization);
  if (!providedSignature) {
    return false;
  }

  const expectedSignature = await hmacSha256Base64(secret, body);
  return timingSafeEqual(providedSignature, expectedSignature);
}

function parseHmacAuthorization(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const [scheme, signature] = value.trim().split(/\s+/, 2);
  return scheme?.toLowerCase() === "hmac" && signature ? signature : null;
}

async function hmacSha256Base64(base64Secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(base64Secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(signature));
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function timingSafeEqual(first: string, second: string): boolean {
  if (first.length !== second.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < first.length; index += 1) {
    mismatch |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return mismatch === 0;
}

function teamsMessageResponse(text: string): Response {
  return new Response(JSON.stringify({ type: "message", text }), {
    headers: { "Content-Type": "application/json" },
  });
}

function truncateTeamsMessage(value: string): string {
  return value.length <= MAX_TEAMS_MESSAGE_LENGTH ? value : `${value.slice(0, MAX_TEAMS_MESSAGE_LENGTH - 3)}...`;
}
