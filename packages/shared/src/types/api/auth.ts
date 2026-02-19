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
});
export type TokenResponse = z.infer<typeof TokenResponse>;

export const LogoutResponse = z.object({
  ok: z.literal(true),
});
export type LogoutResponse = z.infer<typeof LogoutResponse>;
