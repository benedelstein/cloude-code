import type { PullRequestState, SessionWorkingState } from "@repo/shared";
import type { Env } from "@/shared/types";
import {
  SessionsRepository,
  type SessionAccessRow,
  type SessionPullRequestRow,
} from "../repositories/sessions.repository";

export type { SessionAccessRow };
export type { SessionPullRequestRow };

export interface SessionSummaryWriter {
  updateWorkingState(
    sessionId: string,
    workingState: SessionWorkingState,
  ): Promise<void>;
  recordAssistantTurnFinished(
    sessionId: string,
    messageId: string,
    messageCreatedAt: string,
  ): Promise<void>;
  markRead(sessionId: string, messageId: string): Promise<void>;
  updatePushedBranch(sessionId: string, pushedBranch: string): Promise<void>;
  setPullRequest(
    sessionId: string,
    data: { url: string; number: number; state: PullRequestState },
  ): Promise<void>;
  updatePullRequestState(
    sessionId: string,
    state: PullRequestState,
  ): Promise<void>;
}

export function createSessionSummaryWriter(env: Env): SessionSummaryWriter {
  return new SessionsRepository(env.DB);
}

export async function isSessionOwnedByUser(
  env: Env,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  return new SessionsRepository(env.DB).isOwnedByUser(sessionId, userId);
}

export async function getSessionAccessRowForUser(params: {
  env: Env;
  sessionId: string;
  userId: string;
}): Promise<SessionAccessRow | null> {
  return new SessionsRepository(params.env.DB).getAccessRowForUser(
    params.sessionId,
    params.userId,
  );
}

export async function clearSessionAccessBlockAndUpdateBinding(params: {
  env: Env;
  sessionId: string;
  installationId: number;
  repoFullName: string;
}): Promise<void> {
  await new SessionsRepository(params.env.DB).clearAccessBlockAndUpdateBinding(
    params.sessionId,
    {
      installationId: params.installationId,
      repoFullName: params.repoFullName,
    },
  );
}

export async function blockSessionForAccessCheckDenied(params: {
  env: Env;
  sessionId: string;
  clearInstallationId: boolean;
  preserveExistingBlockReason: boolean;
}): Promise<void> {
  await new SessionsRepository(params.env.DB).blockSessionForAccessCheckDenied(
    params.sessionId,
    {
      clearInstallationId: params.clearInstallationId,
      preserveExistingBlockReason: params.preserveExistingBlockReason,
    },
  );
}

export async function blockSessionsForDeletedInstallation(
  env: Env,
  installationId: number,
): Promise<string[]> {
  return new SessionsRepository(env.DB).blockSessionsForDeletedInstallation(
    installationId,
  );
}

export async function blockSessionsForSuspendedInstallation(
  env: Env,
  installationId: number,
): Promise<string[]> {
  return new SessionsRepository(env.DB).blockSessionsForSuspendedInstallation(
    installationId,
  );
}

export async function blockSessionsForRemovedRepos(params: {
  env: Env;
  installationId: number;
  repoIds: number[];
}): Promise<string[]> {
  return new SessionsRepository(params.env.DB).blockSessionsForRemovedRepos(
    params.installationId,
    params.repoIds,
  );
}

export async function findSessionsByPullRequest(params: {
  env: Env;
  installationId: number;
  repoId: number;
  number: number;
}): Promise<SessionPullRequestRow[]> {
  return new SessionsRepository(params.env.DB).findSessionsByPullRequest({
    installationId: params.installationId,
    repoId: params.repoId,
    number: params.number,
  });
}

export async function updateSessionLastMessageAt(
  database: D1Database,
  sessionId: string,
): Promise<void> {
  await new SessionsRepository(database).updateLastMessageAt(sessionId);
}

export async function updateSessionTitle(
  database: D1Database,
  sessionId: string,
  title: string,
): Promise<void> {
  await new SessionsRepository(database).updateTitle(sessionId, title);
}
