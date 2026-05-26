import type { Env } from "@/shared/types";
import {
  OauthStateRepository,
  type OauthStateRecord,
} from "@/shared/repositories/oauth-state-repository";

export async function createOauthState(
  env: Env,
  params: {
    state: string;
    expiresAt: string;
    codeVerifier?: string | null;
    redirectOrigin?: string | null;
  },
): Promise<void> {
  await new OauthStateRepository(env.DB).create(
    params.state,
    params.expiresAt,
    params.codeVerifier ?? null,
    params.redirectOrigin ?? null,
  );
}

export async function consumeValidOauthState(
  env: Env,
  state: string,
): Promise<OauthStateRecord | null> {
  return new OauthStateRepository(env.DB).consumeValid(state);
}

export async function peekOauthRedirectOrigin(
  env: Env,
  state: string,
): Promise<string | null> {
  return new OauthStateRepository(env.DB).peekRedirectOrigin(state);
}
