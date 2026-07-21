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
  continuationToken: z.string().optional(),
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

export const NativeTokenRequest = z.object({
  code: z.string(),
  state: z.string(),
});
export type NativeTokenRequest = z.infer<typeof NativeTokenRequest>;

export const NativeLoginContinuationRequest = z.object({
  state: z.string(),
  token: z.string(),
});
export type NativeLoginContinuationRequest = z.infer<typeof NativeLoginContinuationRequest>;

export const NativeTokenResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.iso.datetime(),
  user: UserInfo,
  hasInstallations: z.boolean(),
  installUrl: z.string(),
});
export type NativeTokenResponse = z.infer<typeof NativeTokenResponse>;

export const RefreshRequest = z.object({
  refreshToken: z.string(),
});
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const RefreshResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.iso.datetime(),
});
export type RefreshResponse = z.infer<typeof RefreshResponse>;

export const NativeLogoutRequest = z.object({
  refreshToken: z.string(),
});
export type NativeLogoutRequest = z.infer<typeof NativeLogoutRequest>;

export const LogoutResponse = z.object({
  ok: z.literal(true),
});
export type LogoutResponse = z.infer<typeof LogoutResponse>;

export const GitHubReauthTokenResponse = z.object({
  ok: z.literal(true),
  installUrl: z.string(),
});
export type GitHubReauthTokenResponse = z.infer<typeof GitHubReauthTokenResponse>;

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
  requiresReauth: z.boolean(),
});
export type OpenAIStatusResponse = z.infer<typeof OpenAIStatusResponse>;

export const OpenAIDisconnectResponse = z.object({
  ok: z.literal(true),
});
export type OpenAIDisconnectResponse = z.infer<typeof OpenAIDisconnectResponse>;

export const OpenAIDeviceStartResponse = z.object({
  attemptId: z.string(),
  verificationUrl: z.string(),
  userCode: z.string(),
  intervalSeconds: z.number().int(),
  expiresAt: z.string(),
});
export type OpenAIDeviceStartResponse = z.infer<typeof OpenAIDeviceStartResponse>;

export const OpenAIDeviceAttemptResponse = z.object({
  status: z.enum(["pending", "completed", "expired"]),
});
export type OpenAIDeviceAttemptResponse = z.infer<typeof OpenAIDeviceAttemptResponse>;

// Claude OAuth types
export const ClaudeAuthUrlResponse = z.object({
  url: z.string(),
  state: z.string(),
});
export type ClaudeAuthUrlResponse = z.infer<typeof ClaudeAuthUrlResponse>;

export const ClaudeTokenRequest = z.object({
  code: z.string(),
  state: z.string(),
  sessionId: z.string().optional(),
});
export type ClaudeTokenRequest = z.infer<typeof ClaudeTokenRequest>;

export const ClaudeTokenResponse = z.object({
  ok: z.literal(true),
});
export type ClaudeTokenResponse = z.infer<typeof ClaudeTokenResponse>;

export const ClaudeStatusResponse = z.object({
  connected: z.boolean(),
  requiresReauth: z.boolean(),
  subscriptionType: z.string().nullable(),
  rateLimitTier: z.string().nullable(),
});
export type ClaudeStatusResponse = z.infer<typeof ClaudeStatusResponse>;

export const ClaudeDisconnectResponse = z.object({
  ok: z.literal(true),
});
export type ClaudeDisconnectResponse = z.infer<typeof ClaudeDisconnectResponse>;
