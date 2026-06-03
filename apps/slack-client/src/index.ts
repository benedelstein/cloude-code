import { Hono } from "hono";
import { z } from "zod";
import { CloudeApiClient } from "./cloude-api";
import { parseSlackCommand } from "./commands";
import { getRuntimeConfig, RuntimeConfig, type Env, type RuntimeConfig as RuntimeConfigType } from "./env";
import {
  postSlackMessage,
  SlackAppMentionEvent,
  SlackEnvelope,
  verifySlackRequest,
} from "./slack";

type SlackClientHonoEnv = {
  Bindings: Env;
};

const app = new Hono<SlackClientHonoEnv>();

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/slack/events", async (c) => {
  const body = await c.req.text();
  const signingSecret = z.string().min(1).safeParse(c.env.SLACK_SIGNING_SECRET);
  if (!signingSecret.success) {
    return c.text("Slack signing secret is not configured", 500);
  }

  const verified = await verifySlackRequest({
    signingSecret: signingSecret.data,
    timestamp: c.req.header("x-slack-request-timestamp"),
    signature: c.req.header("x-slack-signature"),
    body,
  });
  if (!verified) {
    return c.text("invalid signature", 401);
  }

  const parsedJson = parseJson(body);
  if (!parsedJson.ok) {
    return c.text("invalid json", 400);
  }

  const envelope = SlackEnvelope.safeParse(parsedJson.value);
  if (!envelope.success) {
    return c.text("unsupported slack payload", 400);
  }

  if (envelope.data.type === "url_verification") {
    return c.text(envelope.data.challenge, 200);
  }

  const retryNumber = c.req.header("x-slack-retry-num");
  if (retryNumber) {
    return c.text("retry ignored", 200);
  }

  const appMention = SlackAppMentionEvent.safeParse(envelope.data.event);
  if (appMention.success) {
    c.executionCtx.waitUntil(handleAppMention(c.env, appMention.data));
  }

  return c.text("ok", 200);
});

async function handleAppMention(env: Env, event: SlackAppMentionEvent): Promise<void> {
  const configResult = RuntimeConfig.safeParse(getRuntimeConfigInput(env));
  if (!configResult.success) {
    if (env.SLACK_BOT_TOKEN) {
      await replyToSlack(env.SLACK_BOT_TOKEN, event, "Slack client configuration is incomplete.");
    }
    return;
  }

  const config = configResult.data;
  const command = parseSlackCommand(event.text, {
    defaultRepoId: config.defaultRepoId,
  });

  if (!command.ok) {
    await replyToSlack(config.slackBotToken, event, command.message);
    return;
  }

  await replyToSlack(config.slackBotToken, event, "Starting a Cloude Code session...");

  try {
    const cloudeApi = new CloudeApiClient({
      apiUrl: config.cloudeApiUrl,
      apiToken: config.cloudeApiToken,
    });
    const session = await cloudeApi.createSession(command.command);
    await replyToSlack(
      config.slackBotToken,
      event,
      `Started ${formatSessionReference(config, session.sessionId)}.`,
    );
  } catch (error) {
    await replyToSlack(
      config.slackBotToken,
      event,
      `I couldn't start that session: ${formatErrorMessage(error)}`,
    );
  }
}

function getRuntimeConfigInput(env: Env): unknown {
  try {
    return getRuntimeConfig(env);
  } catch (_error) {
    return null;
  }
}

async function replyToSlack(
  botToken: string,
  event: SlackAppMentionEvent,
  text: string,
): Promise<void> {
  await postSlackMessage({
    botToken,
    channel: event.channel,
    threadTs: event.thread_ts ?? event.ts,
    text: `<@${event.user}> ${text}`,
  });
}

function formatSessionReference(config: RuntimeConfigType, sessionId: string): string {
  if (!config.cloudeWebUrl) {
    return `session ${sessionId}`;
  }

  return `<${config.cloudeWebUrl}/session/${sessionId}|session ${sessionId}>`;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "unknown error";
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (_error) {
    return { ok: false };
  }
}

export default {
  fetch: app.fetch,
};
