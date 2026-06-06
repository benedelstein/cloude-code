import { DiscordSessionResponse } from "@repo/shared";
import { z } from "zod";

interface Env {
  API_BASE_URL: string;
  DISCORD_PUBLIC_KEY: string;
  CLOUDE_DISCORD_API_TOKEN: string;
}

interface DiscordUser {
  id: string;
  username?: string;
  global_name?: string | null;
}

interface DiscordInteractionOption {
  name: string;
  type: number;
  value?: string;
}

interface DiscordInteraction {
  type: number;
  token?: string;
  application_id?: string;
  guild_id?: string;
  channel_id?: string;
  user?: DiscordUser;
  member?: { user?: DiscordUser };
  data?: {
    name?: string;
    options?: DiscordInteractionOption[];
  };
}

const DiscordUserSchema = z.object({
  id: z.string(),
  username: z.string().optional(),
  global_name: z.string().nullable().optional(),
});

const DiscordInteractionSchema = z.object({
  type: z.number(),
  token: z.string().optional(),
  application_id: z.string().optional(),
  guild_id: z.string().optional(),
  channel_id: z.string().optional(),
  user: DiscordUserSchema.optional(),
  member: z.object({ user: DiscordUserSchema.optional() }).optional(),
  data: z.object({
    name: z.string().optional(),
    options: z.array(z.object({
      name: z.string(),
      type: z.number(),
      value: z.string().optional(),
    })).optional(),
  }).optional(),
});

const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const RESPONSE_TYPE_PONG = 1;
const RESPONSE_TYPE_CHANNEL_MESSAGE = 4;
const RESPONSE_TYPE_DEFERRED_CHANNEL_MESSAGE = 5;
const EPHEMERAL_FLAG = 64;
const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const body = await request.text();
    const isVerified = await verifyDiscordRequest(request, body, env.DISCORD_PUBLIC_KEY);
    if (!isVerified) {
      return new Response("invalid request signature", { status: 401 });
    }

    const interaction = parseInteraction(body);
    if (!interaction) {
      return jsonResponse(channelMessage("Invalid Discord interaction payload."));
    }

    if (interaction.type === INTERACTION_TYPE_PING) {
      return jsonResponse({ type: RESPONSE_TYPE_PONG });
    }

    if (interaction.type !== INTERACTION_TYPE_APPLICATION_COMMAND) {
      return jsonResponse(channelMessage("Unsupported Discord interaction type."));
    }

    const prompt = getPrompt(interaction);
    const user = interaction.member?.user ?? interaction.user;
    if (!prompt || !user || !interaction.application_id || !interaction.token) {
      return jsonResponse(channelMessage("Use `/cloude prompt:<what to change>` to create a session."));
    }

    ctx.waitUntil(createSessionAndEditResponse({ env, interaction, prompt, user }));
    return jsonResponse({
      type: RESPONSE_TYPE_DEFERRED_CHANNEL_MESSAGE,
      data: { flags: EPHEMERAL_FLAG },
    });
  },
};

async function createSessionAndEditResponse(params: {
  env: Env;
  interaction: DiscordInteraction;
  prompt: string;
  user: DiscordUser;
}): Promise<void> {
  const response = await fetch(`${params.env.API_BASE_URL.replace(/\/$/, "")}/discord/session-requests`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${params.env.CLOUDE_DISCORD_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      discordUserId: params.user.id,
      discordUsername: params.user.global_name ?? params.user.username,
      prompt: params.prompt,
      guildId: params.interaction.guild_id,
      channelId: params.interaction.channel_id,
    }),
  });

  const message = await buildDiscordMessage(response);
  await editOriginalInteractionResponse({
    applicationId: params.interaction.application_id!,
    interactionToken: params.interaction.token!,
    content: message,
  });
}

async function buildDiscordMessage(response: Response): Promise<string> {
  if (!response.ok) {
    return "I could not create a Cloude session. The API rejected the request.";
  }

  const parsed = DiscordSessionResponse.safeParse(await response.json());
  if (!parsed.success) {
    return "I could not create a Cloude session. The API returned an unexpected response.";
  }

  if (!parsed.data.ok) {
    if (parsed.data.linkUrl) {
      const expires = parsed.data.linkExpiresAt
        ? ` This link expires at ${new Date(parsed.data.linkExpiresAt).toLocaleString()}.`
        : "";
      return truncateDiscordMessage(
        `${parsed.data.message} ${parsed.data.linkUrl}${expires}`,
      );
    }

    const candidates = parsed.data.candidates?.map((candidate) => `- ${candidate.repoFullName}`).join("\n");
    return truncateDiscordMessage([
      `I could not create a session: ${parsed.data.message}`,
      candidates ? `\nPossible repos:\n${candidates}` : "",
    ].join(""));
  }

  const title = parsed.data.title ? ` (${parsed.data.title})` : "";
  const link = parsed.data.sessionUrl ? `\n${parsed.data.sessionUrl}` : "";
  const reason = parsed.data.routingReason ? `\nRouting: ${parsed.data.routingReason}` : "";
  return truncateDiscordMessage(
    `Started a Cloude session in ${parsed.data.repoFullName}${title}.${link}${reason}`,
  );
}

async function editOriginalInteractionResponse(params: {
  applicationId: string;
  interactionToken: string;
  content: string;
}): Promise<void> {
  await fetch(
    `${DISCORD_API_BASE_URL}/webhooks/${params.applicationId}/${params.interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: params.content,
        allowed_mentions: { parse: [] },
      }),
    },
  );
}

function channelMessage(content: string) {
  return {
    type: RESPONSE_TYPE_CHANNEL_MESSAGE,
    data: {
      content,
      flags: EPHEMERAL_FLAG,
      allowed_mentions: { parse: [] },
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

function parseInteraction(body: string): DiscordInteraction | null {
  try {
    const parsed = DiscordInteractionSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function getPrompt(interaction: DiscordInteraction): string | null {
  if (interaction.data?.name !== "cloude") {
    return null;
  }
  const option = interaction.data.options?.find((item) => item.name === "prompt");
  return typeof option?.value === "string" && option.value.trim()
    ? option.value.trim()
    : null;
}

async function verifyDiscordRequest(
  request: Request,
  body: string,
  publicKeyHex: string,
): Promise<boolean> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp) {
    return false;
  }

  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      "Ed25519",
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "Ed25519",
      publicKey,
      hexToBytes(signature),
      new TextEncoder().encode(`${timestamp}${body}`),
    );
  } catch {
    return false;
  }
}

function hexToBytes(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[\da-f]+$/i.test(value)) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function truncateDiscordMessage(value: string): string {
  return value.length <= 1900 ? value : `${value.slice(0, 1897)}...`;
}
