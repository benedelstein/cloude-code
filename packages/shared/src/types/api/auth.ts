import { z } from "zod";

export const UserInfo = z.object({
  id: z.string(),
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type UserInfo = z.infer<typeof UserInfo>;

export const GitHubAuthUrlResponse = z.object({
  url: z.string(),
  state: z.string(),
});
export type GitHubAuthUrlResponse = z.infer<typeof GitHubAuthUrlResponse>;

export const TokenRequest = z.object({
  code: z.string(),
  state: z.string(),
});
export type TokenRequest = z.infer<typeof TokenRequest>;

export const TokenResponse = z.object({
  token: z.string(),
  user: UserInfo,
  hasInstallations: z.boolean(),
  installUrl: z.string(),
});
export type TokenResponse = z.infer<typeof TokenResponse>;

export const LogoutResponse = z.object({
  ok: z.literal(true),
});
export type LogoutResponse = z.infer<typeof LogoutResponse>;

// OpenAI OAuth types
export const OpenAIAuthUrlResponse = z.object({
  url: z.string(),
  state: z.string(),
});
export type OpenAIAuthUrlResponse = z.infer<typeof OpenAIAuthUrlResponse>;

export const OpenAITokenRequest = z.object({
  code: z.string(),
  state: z.string(),
});
export type OpenAITokenRequest = z.infer<typeof OpenAITokenRequest>;

export const OpenAITokenResponse = z.object({
  ok: z.literal(true),
});
export type OpenAITokenResponse = z.infer<typeof OpenAITokenResponse>;

export const OpenAIStatusResponse = z.object({
  connected: z.boolean(),
});
export type OpenAIStatusResponse = z.infer<typeof OpenAIStatusResponse>;

export const OpenAIDisconnectResponse = z.object({
  ok: z.literal(true),
});
export type OpenAIDisconnectResponse = z.infer<typeof OpenAIDisconnectResponse>;

// Claude OAuth types
export const ClaudeAuthUrlResponse = z.object({
  url: z.string(),
  state: z.string(),
});
export type ClaudeAuthUrlResponse = z.infer<typeof ClaudeAuthUrlResponse>;

export const ClaudeTokenRequest = z.object({
  code: z.string(),
  state: z.string(),
});
export type ClaudeTokenRequest = z.infer<typeof ClaudeTokenRequest>;

export const ClaudeTokenResponse = z.object({
  ok: z.literal(true),
});
export type ClaudeTokenResponse = z.infer<typeof ClaudeTokenResponse>;

export const ClaudeStatusResponse = z.object({
  connected: z.boolean(),
});
export type ClaudeStatusResponse = z.infer<typeof ClaudeStatusResponse>;

export const ClaudeDisconnectResponse = z.object({
  ok: z.literal(true),
});
export type ClaudeDisconnectResponse = z.infer<typeof ClaudeDisconnectResponse>;
