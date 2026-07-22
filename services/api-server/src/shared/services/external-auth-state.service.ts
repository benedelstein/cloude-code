import type { Env } from "@/shared/types";
import {
  ExternalAuthStateRepository,
  type ExternalAuthStateRecord,
} from "@/shared/repositories/external-auth-state.repository";

export async function createExternalAuthState(
  env: Env,
  params: {
    state: string;
    expiresAt: string;
    codeVerifier?: string | null;
    redirectOrigin?: string | null;
    purpose?: string | null;
    userId?: string | null;
    signInAttemptId?: string | null;
  },
): Promise<void> {
  const repository = new ExternalAuthStateRepository(env.DB);
  // Creation is the only frequent write, so it is also where expired rows are
  // reaped. Reads already reject them; this bounds how long they persist.
  await repository.deleteExpired();
  await repository.create({
    state: params.state,
    expiresAt: params.expiresAt,
    codeVerifier: params.codeVerifier ?? null,
    redirectOrigin: params.redirectOrigin ?? null,
    purpose: params.purpose ?? null,
    userId: params.userId ?? null,
    signInAttemptId: params.signInAttemptId ?? null,
  });
}

export async function consumeValidExternalAuthState(
  env: Env,
  state: string,
): Promise<ExternalAuthStateRecord | null> {
  return new ExternalAuthStateRepository(env.DB).consumeValid(state);
}

export async function peekExternalAuthState(
  env: Env,
  state: string,
): Promise<ExternalAuthStateRecord | null> {
  return new ExternalAuthStateRepository(env.DB).peek(state);
}
