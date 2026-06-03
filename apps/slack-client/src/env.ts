import { z } from "zod";

export interface Env {
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  CLOUDE_API_URL: string;
  CLOUDE_API_TOKEN: string;
  CLOUDE_WEB_URL?: string;
  CLOUDE_DEFAULT_REPO_ID?: string;
}

export const RuntimeConfig = z.object({
  slackSigningSecret: z.string().min(1),
  slackBotToken: z.string().min(1),
  cloudeApiUrl: z.string().url(),
  cloudeApiToken: z.string().min(1),
  cloudeWebUrl: z.string().url().optional(),
  defaultRepoId: z.number().int().positive().optional(),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfig>;

export function getRuntimeConfig(env: Env): RuntimeConfig {
  const defaultRepoIdText = env.CLOUDE_DEFAULT_REPO_ID?.trim();
  const webUrlText = env.CLOUDE_WEB_URL?.trim();

  return RuntimeConfig.parse({
    slackSigningSecret: env.SLACK_SIGNING_SECRET,
    slackBotToken: env.SLACK_BOT_TOKEN,
    cloudeApiUrl: env.CLOUDE_API_URL,
    cloudeApiToken: env.CLOUDE_API_TOKEN,
    cloudeWebUrl: webUrlText ? trimTrailingSlash(webUrlText) : undefined,
    defaultRepoId: defaultRepoIdText ? Number(defaultRepoIdText) : undefined,
  });
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
