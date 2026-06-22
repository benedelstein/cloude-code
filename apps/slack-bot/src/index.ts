import { IntegrationSessionResponse } from "@repo/shared";
import { z } from "zod";

interface Env {
  API_BASE_URL: string;
  INTEGRATION_SESSION_REQUEST_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
}

const SlackCommandSchema = z.object({
  channel_id: z.string().optional(),
  channel_name: z.string().optional(),
  command: z.string(),
  response_url: z.string().url(),
  team_id: z.string().optional(),
  text: z.string().optional(),
  user_id: z.string(),
  user_name: z.string().optional(),
});

type SlackCommand = z.infer<typeof SlackCommandSchema>;

const SLACK_SIGNATURE_VERSION = "v0";
const SIGNATURE_TOLERANCE_SECONDS = 60 * 5;
const MAX_SLACK_MESSAGE_LENGTH = 3000;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const body = await request.text();
    const isVerified = await verifySlackRequest(request, body, env.SLACK_SIGNING_SECRET);
    if (!isVerified) {
      return new Response("invalid request signature", { status: 401 });
    }

    const command = parseSlackCommand(body);
    if (!command) {
      return slackJsonResponse("Invalid Slack command payload.");
    }

    const prompt = command.text?.trim();
    if (command.command !== "/cloude" || !prompt) {
      return slackJsonResponse("Use `/cloude <what to change, including the repo hint>` to create a session.");
    }

    ctx.waitUntil(createSessionAndPostResponse({ env, command, prompt }));
    return slackJsonResponse("Creating a Cloude session...");
  },
};

async function createSessionAndPostResponse(params: {
  env: Env;
  command: SlackCommand;
  prompt: string;
}): Promise<void> {
  let message = "I could not create a Cloude session. Something went wrong, please try again.";
  try {
    const response = await fetch(`${params.env.API_BASE_URL.replace(/\/$/, "")}/integrations/session-requests`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${params.env.INTEGRATION_SESSION_REQUEST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        externalUser: {
          provider: "slack",
          id: params.command.user_id,
          displayName: params.command.user_name,
          teamId: params.command.team_id,
        },
        prompt: params.prompt,
      }),
    });
    message = await buildSlackMessage(response);
  } catch {
    // Fall through and report the generic failure so the user receives a final response.
  }

  await postSlackResponse(params.command.response_url, message);
}

async function buildSlackMessage(response: Response): Promise<string> {
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
      return truncateSlackMessage(`${parsed.data.message} ${parsed.data.linkUrl}${expires}`);
    }

    const candidates = parsed.data.candidates?.map((candidate) => `- ${candidate.repoFullName}`).join("\n");
    return truncateSlackMessage([
      `I could not create a session: ${parsed.data.message}`,
      candidates ? `\nPossible repos:\n${candidates}` : "",
    ].join(""));
  }

  const title = parsed.data.title ? ` (${parsed.data.title})` : "";
  const link = parsed.data.sessionUrl ? `\n${parsed.data.sessionUrl}` : "";
  const reason = parsed.data.routingReason ? `\nRouting: ${parsed.data.routingReason}` : "";
  return truncateSlackMessage(`Started a Cloude session in ${parsed.data.repoFullName}${title}.${link}${reason}`);
}

async function postSlackResponse(responseUrl: string, text: string): Promise<void> {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_type: "ephemeral",
      text,
    }),
  });
}

function parseSlackCommand(body: string): SlackCommand | null {
  const parsed = SlackCommandSchema.safeParse(Object.fromEntries(new URLSearchParams(body)));
  return parsed.success ? parsed.data : null;
}

function slackJsonResponse(text: string): Response {
  return new Response(JSON.stringify({ response_type: "ephemeral", text }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function verifySlackRequest(request: Request, body: string, signingSecret: string): Promise<boolean> {
  const timestamp = request.headers.get("X-Slack-Request-Timestamp");
  const signature = request.headers.get("X-Slack-Signature");
  if (!timestamp || !signature) {
    return false;
  }

  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const signedPayload = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${body}`;
  const expectedSignature = `${SLACK_SIGNATURE_VERSION}=${await hmacSha256Hex(signingSecret, signedPayload)}`;
  return timingSafeEqual(signature, expectedSignature);
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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

function truncateSlackMessage(value: string): string {
  return value.length <= MAX_SLACK_MESSAGE_LENGTH ? value : `${value.slice(0, MAX_SLACK_MESSAGE_LENGTH - 3)}...`;
}
