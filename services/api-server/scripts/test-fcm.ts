#!/usr/bin/env npx tsx

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { NotificationMessageData } from "@repo/api-contract";
import { config } from "dotenv";
import { FcmProvider } from "../src/modules/notifications/providers/fcm.provider";
import type { NotificationQueueMessage } from "../src/modules/notifications/types/notification.types";

config({ path: ".env.local", quiet: true });
config({ path: ".dev.vars", quiet: true });

interface CliOptions {
  body: string;
  serviceAccountJsonPath?: string;
  title: string;
  token?: string;
}

interface ServiceAccountPreview {
  client_email?: string;
  project_id?: string;
}

function usage(exitCode: number): never {
  console.error([
    "Usage: pnpm --filter @repo/api-server test:fcm -- --token <fcm-token>",
    "",
    "Options:",
    "  --token <token>                  Required FCM registration token",
    "  --service-account-json <path>    Optional Firebase service account JSON file",
    "  --title <text>                   Optional notification title",
    "  --body <text>                    Optional notification body",
    "",
    "Env fallback:",
    "  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64",
  ].join("\n"));
  process.exit(exitCode);
}

function readNext(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    body: "FCM local test body",
    title: "FCM local test",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--token":
        options.token = readNext(args, index, arg);
        index += 1;
        break;
      case "--service-account-json":
        options.serviceAccountJsonPath = readNext(args, index, arg);
        index += 1;
        break;
      case "--title":
        options.title = readNext(args, index, arg);
        index += 1;
        break;
      case "--body":
        options.body = readNext(args, index, arg);
        index += 1;
        break;
      case "--":
        break;
      case "--help":
      case "-h":
        usage(0);
        break;
      default:
        if (!arg?.startsWith("--") && !options.token) {
          options.token = arg;
          break;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function loadServiceAccountBase64(options: CliOptions): Promise<string> {
  if (options.serviceAccountJsonPath) {
    const json = await readFile(resolve(options.serviceAccountJsonPath), "utf8");
    return Buffer.from(json, "utf8").toString("base64");
  }

  const value = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!value) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 or --service-account-json");
  }
  return value;
}

function previewServiceAccount(base64: string): ServiceAccountPreview {
  return JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as ServiceAccountPreview;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.token) {
    usage(1);
  }

  const serviceAccountBase64 = await loadServiceAccountBase64(options);
  const serviceAccount = previewServiceAccount(serviceAccountBase64);
  console.log("Firebase service account:", {
    clientEmail: serviceAccount.client_email,
    projectId: serviceAccount.project_id,
  });
  console.log("Target FCM token:", `${options.token.slice(0, 12)}...${options.token.slice(-8)}`);

  const provider = new FcmProvider(serviceAccountBase64);
  const event: NotificationQueueMessage = {
    id: crypto.randomUUID(),
    toUserId: "local-fcm-test-user",
    title: options.title,
    body: options.body,
    payload: {
      type: "TURN_FINISHED",
      version: 1,
      sessionId: crypto.randomUUID(),
      messageId: "local-fcm-test-message",
      repoFullName: "local/fcm-test",
    },
    createdAt: new Date().toISOString(),
  };
  const result = await provider.send({
    token: options.token,
    event,
  });

  if (result.ok) {
    console.log("FCM send succeeded");
    return;
  }

  console.error("FCM send failed:", result.error);
  await printRawFcmFailure({
    event,
    provider,
    serviceAccountBase64,
    token: options.token,
  });
  process.exit(2);
}

async function printRawFcmFailure(params: {
  event: NotificationQueueMessage;
  provider: FcmProvider;
  serviceAccountBase64: string;
  token: string;
}): Promise<void> {
  const account = previewServiceAccount(params.serviceAccountBase64);
  if (!account.project_id) {
    return;
  }

  const accessToken = await (params.provider as unknown as { getAccessToken: () => Promise<string> }).getAccessToken();
  const data = {
    notification_id: params.event.id,
    notification_type: params.event.payload.type,
    payload: JSON.stringify(params.event.payload),
  } satisfies NotificationMessageData;

  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: params.token,
        notification: {
          title: params.event.title,
          body: params.event.body,
        },
        data,
        apns: {
          payload: {
            aps: {
              sound: "default",
            },
          },
        },
      },
    }),
  });

  console.error("Raw FCM response:", {
    body: await response.text(),
    status: response.status,
  });
}

main().catch((error: unknown) => {
  console.error("FCM test threw:", error);
  process.exit(1);
});
