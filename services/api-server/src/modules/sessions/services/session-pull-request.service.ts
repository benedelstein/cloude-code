import type { UIMessage } from "ai";
import type { SessionAgentRpc } from "@/shared/types/session-agent";
import { failure, success, type Result, type SessionInfoResponse } from "@repo/shared";
import type {
  HandleGetSessionResult,
  UpdatePullRequestRequest,
} from "@/shared/types/session-agent";
import {
  fallbackPullRequestTitle,
  generatePullRequestText,
} from "./generate-pull-request-text.service";
import type {
  CreatePullRequestInput,
  GitHubAppResult,
  GitHubCompareData,
  PullRequestData,
} from "@/shared/types/github";
import { createLogger } from "@/shared/logging";
import { sanitizeGitBranchName } from "@/shared/utils/git-branch";

const logger = createLogger("session-pull-request-service.ts");

const MAX_CONTEXT_MESSAGES = 12;
const MAX_CONTEXT_CHARS = 280;

type SessionAgentStub = SessionAgentRpc;

export interface CreatePullRequestForSessionContextParams {
  github: SessionPullRequestGitHubProvider;
  anthropicApiKey: string;
  repoFullName: string;
  baseBranch: string;
  headBranch: string;
  sessionMessages: UIMessage[];
  sessionUrl?: string;
}

export interface CreatedPullRequestResult {
  url: string;
  number: number;
  state: "open";
}

export type PullRequestCreationError = {
  code: "PULL_REQUEST_CREATE_FAILED";
  message: string;
  details?: string;
};

export interface SessionPullRequestGitHubProvider {
  compareBranches(
    repoFullName: string,
    baseBranch: string,
    headBranch: string,
  ): Promise<GitHubAppResult<GitHubCompareData>>;
  createPullRequest(
    repoFullName: string,
    input: CreatePullRequestInput,
  ): Promise<GitHubAppResult<PullRequestData>>;
  getPullRequest(
    repoFullName: string,
    pullRequestNumber: number,
  ): Promise<GitHubAppResult<PullRequestData>>;
}

export class SessionPullRequestServiceError extends Error {
  status: number;
  responseBody: {
    error: string;
    details?: string;
    url?: string;
  };

  constructor(
    message: string,
    status: number,
    responseBody: {
      error: string;
      details?: string;
      url?: string;
    },
  ) {
    super(message);
    this.name = "SessionPullRequestServiceError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

function extractMessageText(message: UIMessage): string {
  const messageParts = Array.isArray(message.parts) ? message.parts : [];
  const textParts: string[] = [];

  for (const part of messageParts) {
    if (part.type === "text" && typeof part.text === "string") {
      const normalizedText = part.text.replace(/\s+/g, " ").trim();
      if (normalizedText) {
        textParts.push(normalizedText);
      }
    }
  }

  return textParts.join(" ").trim();
}

function buildPullRequestContextMessages(messages: UIMessage[]): string[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((message) => {
      const text = extractMessageText(message);
      if (!text) {
        return null;
      }
      return `${message.role}: ${text.slice(0, MAX_CONTEXT_CHARS)}`;
    })
    .filter((message): message is string => Boolean(message));
}

function appendSessionLinkToPullRequestBody(body: string, sessionUrl?: string): string {
  if (!sessionUrl) {
    return body;
  }

  const footer = `My Machines session: ${sessionUrl}`;
  const trimmedBody = body.trimEnd();
  return trimmedBody ? `${trimmedBody}\n\n${footer}` : footer;
}

async function getSessionInfo(sessionStub: SessionAgentStub): Promise<SessionInfoResponse> {
  const result = (await sessionStub.handleGetSession()) as HandleGetSessionResult;
  if (!result.ok) {
    throw new SessionPullRequestServiceError(
      "Session not found",
      404,
      { error: "Session not found" },
    );
  }
  return result.value;
}

export async function createPullRequestForSessionContext(
  params: CreatePullRequestForSessionContextParams,
): Promise<Result<CreatedPullRequestResult, PullRequestCreationError>> {
  const { github, anthropicApiKey, repoFullName, headBranch, sessionMessages, sessionUrl } = params;
  const baseBranch = sanitizeGitBranchName(params.baseBranch) ?? "main";
  const pullRequestContextMessages = buildPullRequestContextMessages(sessionMessages);

  let compareData: GitHubCompareData | null = null;
  const compareDataResult = await github.compareBranches(
    repoFullName,
    baseBranch,
    headBranch,
  );
  if (!compareDataResult.ok) {
    logger.error("Failed to fetch GitHub compare data for PR text generation", {
      fields: {
        code: compareDataResult.error.code,
        message: compareDataResult.error.message,
        details: compareDataResult.error.details ?? null,
        baseBranch,
        branchName: headBranch,
      },
    });
  } else {
    compareData = compareDataResult.value;
  }

  const compareFiles = compareData?.files ?? [];
  let pullRequestTitle = fallbackPullRequestTitle(headBranch, compareFiles);
  let pullRequestBody = "";

  if (compareData) {
    const pullRequestText = await generatePullRequestText(
      anthropicApiKey,
      {
        repoFullName,
        baseBranch,
        headBranch,
        aheadBy: compareData.aheadBy,
        totalCommits: compareData.totalCommits,
        files: compareFiles,
        commits: compareData.commits,
        recentMessages: pullRequestContextMessages,
      },
    );

    if (pullRequestText) {
      pullRequestTitle = pullRequestText.title;
      pullRequestBody = pullRequestText.body;
    }
  }

  const createPullRequestResult = await github.createPullRequest(repoFullName, {
    title: pullRequestTitle,
    body: appendSessionLinkToPullRequestBody(pullRequestBody, sessionUrl),
    head: headBranch,
    base: baseBranch,
  });
  if (!createPullRequestResult.ok) {
    const details = createPullRequestResult.error.details
      ?? createPullRequestResult.error.message;
    const responseDetails = `${details} (base: ${baseBranch}, head: ${headBranch})`;
    return failure({
      code: "PULL_REQUEST_CREATE_FAILED",
      message: "Failed to create pull request",
      details: responseDetails,
    });
  }
  const createdPullRequestValue = createPullRequestResult.value;

  return success({
    url: createdPullRequestValue.url,
    number: createdPullRequestValue.number,
    state: "open",
  });
}

export async function getPullRequestStatusForSession(params: {
  sessionStub: SessionAgentStub;
  githubService: SessionPullRequestGitHubProvider;
}): Promise<{
  url: string;
  number: number;
  state: "open" | "closed" | "merged";
  merged: boolean;
}> {
  const { sessionStub, githubService: githubService } = params;
  const session = await getSessionInfo(sessionStub);

  if (!session.pullRequestNumber || !session.pullRequestUrl) {
    throw new SessionPullRequestServiceError(
      "No pull request exists",
      404,
      { error: "No pull request exists" },
    );
  }

  const pullRequestResult = await githubService.getPullRequest(
    session.repoFullName,
    session.pullRequestNumber,
  );
  if (!pullRequestResult.ok) {
    logger.error("Failed to fetch PR status", {
      fields: { code: pullRequestResult.error.code, message: pullRequestResult.error.message },
    });
    throw new SessionPullRequestServiceError(
      "Failed to fetch PR status",
      500,
      { error: "Failed to fetch PR status" },
    );
  }
  const pullRequestStateValue = {
    state: pullRequestResult.value.state,
    merged: pullRequestResult.value.merged,
  };

  const state = pullRequestStateValue.merged ? "merged" : pullRequestStateValue.state;
  if (state !== session.pullRequestState) {
    const updatePullRequestBody: UpdatePullRequestRequest = { state };
    try {
      await sessionStub.updatePullRequest(updatePullRequestBody);
    } catch (error) {
      // Non-fatal: state sync failure shouldn't prevent returning PR status
      logger.error("Failed to update PR state in session:", { error });
    }
  }

  return {
    url: session.pullRequestUrl,
    number: session.pullRequestNumber,
    state,
    merged: pullRequestStateValue.merged,
  };
}
