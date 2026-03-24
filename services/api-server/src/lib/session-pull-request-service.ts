import type { SessionInfoResponse } from "@repo/shared";
import type { UIMessage } from "ai";
import type { SetPullRequestRequest, UpdatePullRequestRequest } from "@/types/session-agent";
import {
  fallbackPullRequestTitle,
  generatePullRequestText,
} from "@/lib/generate-pull-request-text";
import type { GitHubAppService, GitHubCompareData } from "@/lib/github";
import { createLogger } from "./logger";

const logger = createLogger("session-pull-request-service.ts");

const MAX_CONTEXT_MESSAGES = 12;
const MAX_CONTEXT_CHARS = 280;

interface SessionAgentFetcher {
  // eslint-disable-next-line no-unused-vars
  fetch(_request: Request): Promise<Response>;
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

async function getSessionInfo(sessionStub: SessionAgentFetcher): Promise<SessionInfoResponse> {
  let sessionResponse: Response;
  try {
    sessionResponse = await sessionStub.fetch(new Request("http://do/"));
  } catch (error) {
    logger.error("Failed to fetch session info", { error });
    throw new SessionPullRequestServiceError(
      "Failed to reach session",
      500,
      { error: "Failed to reach session" },
    );
  }
  if (!sessionResponse.ok) {
    throw new SessionPullRequestServiceError(
      "Session not found",
      404,
      { error: "Session not found" },
    );
  }
  return (await sessionResponse.json()) as SessionInfoResponse;
}

async function getSessionMessages(sessionStub: SessionAgentFetcher): Promise<UIMessage[]> {
  try {
    const messagesResponse = await sessionStub.fetch(new Request("http://do/messages"));
    if (!messagesResponse.ok) {
      return [];
    }
    return (await messagesResponse.json()) as UIMessage[];
  } catch (error) {
    logger.error("Failed to fetch session messages for PR text generation:", { error });
    return [];
  }
}

export async function createPullRequestForSession(params: {
  sessionStub: SessionAgentFetcher;
  github: GitHubAppService;
  anthropicApiKey: string;
}): Promise<{
  url: string;
  number: number;
  state: "open";
}> {
  const { sessionStub, github, anthropicApiKey } = params;
  const session = await getSessionInfo(sessionStub);

  if (!session.pushedBranch) {
    throw new SessionPullRequestServiceError(
      "No branch has been pushed yet",
      400,
      { error: "No branch has been pushed yet" },
    );
  }

  if (session.pullRequestUrl) {
    throw new SessionPullRequestServiceError(
      "Pull request already exists",
      409,
      { error: "Pull request already exists", url: session.pullRequestUrl },
    );
  }

  const [owner, repo] = session.repoFullName.split("/");
  if (!owner || !repo) {
    throw new SessionPullRequestServiceError(
      "Invalid repoFullName",
      400,
      { error: "Invalid repoFullName" },
    );
  }

  const branchName = session.pushedBranch;
  const baseBranch = session.baseBranch ?? "main";
  const sessionMessages = await getSessionMessages(sessionStub);
  const pullRequestContextMessages = buildPullRequestContextMessages(sessionMessages);

  let compareData: GitHubCompareData | null = null;
  const compareDataResult = await github.compareBranches(
    session.repoFullName,
    baseBranch,
    branchName,
  );
  if (!compareDataResult.ok) {
    logger.error("Failed to fetch GitHub compare data for PR text generation", {
      fields: { code: compareDataResult.error.code, message: compareDataResult.error.message },
    });
  } else {
    compareData = compareDataResult.value;
  }

  const compareFiles = compareData?.files ?? [];
  let pullRequestTitle = fallbackPullRequestTitle(branchName, compareFiles);
  let pullRequestBody = "";

  if (compareData) {
    const pullRequestText = await generatePullRequestText(
      anthropicApiKey,
      {
        repoFullName: session.repoFullName,
        baseBranch,
        headBranch: branchName,
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

  const createPullRequestResult = await github.createPullRequest(session.repoFullName, {
    title: pullRequestTitle,
    body: pullRequestBody,
    head: branchName,
    base: baseBranch,
  });
  if (!createPullRequestResult.ok) {
    throw new SessionPullRequestServiceError(
      "Failed to create pull request",
      400,
      {
        error: "Failed to create pull request",
        details: createPullRequestResult.error.message,
      },
    );
  }
  const createdPullRequestValue = createPullRequestResult.value;

  const setPullRequestBody: SetPullRequestRequest = {
    url: createdPullRequestValue.url,
    number: createdPullRequestValue.number,
    state: "open",
  };
  try {
    await sessionStub.fetch(
      new Request("http://do/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setPullRequestBody),
      }),
    );
  } catch (error) {
    // PR was created on GitHub but state failed to persist in the DO.
    // Log the error but still return success — the PR exists on GitHub.
    logger.error("Failed to persist PR state in session after creation", { error });
  }

  return {
    url: createdPullRequestValue.url,
    number: createdPullRequestValue.number,
    state: "open",
  };
}

export async function getPullRequestStatusForSession(params: {
  sessionStub: SessionAgentFetcher;
  githubService: GitHubAppService;
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
      await sessionStub.fetch(
        new Request("http://do/pr", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatePullRequestBody),
        }),
      );
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
