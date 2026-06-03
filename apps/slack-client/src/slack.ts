import { z } from "zod";

const signatureVersion = "v0";
const maxSignatureAgeMs = 5 * 60 * 1000;

export const SlackUrlVerificationEnvelope = z.object({
  type: z.literal("url_verification"),
  challenge: z.string().min(1),
});
export type SlackUrlVerificationEnvelope = z.infer<typeof SlackUrlVerificationEnvelope>;

export const SlackAppMentionEvent = z.object({
  type: z.literal("app_mention"),
  user: z.string().min(1),
  text: z.string(),
  ts: z.string().min(1),
  channel: z.string().min(1),
  thread_ts: z.string().min(1).optional(),
});
export type SlackAppMentionEvent = z.infer<typeof SlackAppMentionEvent>;

export const SlackEventCallbackEnvelope = z.object({
  type: z.literal("event_callback"),
  event_id: z.string().min(1),
  event: z.object({ type: z.string().min(1) }).passthrough(),
});
export type SlackEventCallbackEnvelope = z.infer<typeof SlackEventCallbackEnvelope>;

export const SlackEnvelope = z.discriminatedUnion("type", [
  SlackUrlVerificationEnvelope,
  SlackEventCallbackEnvelope,
]);
export type SlackEnvelope = z.infer<typeof SlackEnvelope>;

export async function verifySlackRequest(params: {
  signingSecret: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  body: string;
  now?: number;
}): Promise<boolean> {
  if (!params.timestamp || !params.signature) {
    return false;
  }

  const timestampSeconds = Number(params.timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const now = params.now ?? Date.now();
  if (Math.abs(now - timestampSeconds * 1000) > maxSignatureAgeMs) {
    return false;
  }

  const baseString = `${signatureVersion}:${params.timestamp}:${params.body}`;
  const digest = await hmacSha256Hex(params.signingSecret, baseString);
  const expected = `${signatureVersion}=${digest}`;

  return constantTimeEqual(expected, params.signature);
}

export async function postSlackMessage(params: {
  botToken: string;
  channel: string;
  text: string;
  threadTs?: string;
  fetcher?: typeof fetch;
}): Promise<void> {
  const fetcher = params.fetcher ?? fetch;
  const response = await fetcher("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${params.botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: params.channel,
      text: params.text,
      thread_ts: params.threadTs,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });

  const body = await response.json().catch(() => null) as unknown;
  const result = z.object({ ok: z.boolean(), error: z.string().optional() }).safeParse(body);
  if (!response.ok || !result.success || !result.data.ok) {
    throw new Error(result.success ? result.data.error ?? "Slack post failed" : "Slack post failed");
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length === rightBytes.length ? 0 : 1;

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
