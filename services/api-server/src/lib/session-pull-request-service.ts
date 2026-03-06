import type { SessionInfoResponse } from "@repo/shared";
import type { UIMessage } from "ai";
import {
  fallbackPullRequestTitle,
  generatePullRequestText,
} from "@/lib/generate-pull-request-text";
import type { GitHubAppService, GitHubCompareData } from "@/lib/github";

const MAX_CONTEXT_MESSAGES = 12;
const MAX_CONTEXT_CHARS = 280;

interface SessionAgentFetcher {
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
  const sessionResponse = await sessionStub.fetch(new Request("http://do/"));
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
    console.error("Failed to fetch session messages for PR text generation:", error);
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
  try {
    compareData = await github.compareBranches(
      session.repoFullName,
      baseBranch,
      branchName,
    );
  } catch (error) {
    console.error("Failed to fetch GitHub compare data for PR text generation:", error);
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

  let createdPullRequest: {
    number: number;
    url: string;
  };
  try {
    createdPullRequest = await github.createPullRequest(session.repoFullName, {
      title: pullRequestTitle,
      body: pullRequestBody,
      head: branchName,
      base: baseBranch,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new SessionPullRequestServiceError(
      "Failed to create pull request",
      400,
      { error: "Failed to create pull request", details },
    );
  }

  await sessionStub.fetch(
    new Request("http://do/pr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: createdPullRequest.url,
        number: createdPullRequest.number,
        state: "open",
      }),
    }),
  );

  return {
    url: createdPullRequest.url,
    number: createdPullRequest.number,
    state: "open",
  };
}

export async function getPullRequestStatusForSession(params: {
  sessionStub: SessionAgentFetcher;
  github: GitHubAppService;
}): Promise<{
  url: string;
  number: number;
  state: "open" | "closed" | "merged";
  merged: boolean;
}> {
  const { sessionStub, github } = params;
  const session = await getSessionInfo(sessionStub);

  if (!session.pullRequestNumber || !session.pullRequestUrl) {
    throw new SessionPullRequestServiceError(
      "No pull request exists",
      404,
      { error: "No pull request exists" },
    );
  }

  let pullRequestState: {
    state: "open" | "closed";
    merged: boolean;
  };
  try {
    const pullRequest = await github.getPullRequest(
      session.repoFullName,
      session.pullRequestNumber,
    );
    pullRequestState = {
      state: pullRequest.state,
      merged: pullRequest.merged,
    };
  } catch (_error) {
    throw new SessionPullRequestServiceError(
      "Failed to fetch PR status",
      500,
      { error: "Failed to fetch PR status" },
    );
  }

  const state = pullRequestState.merged ? "merged" : pullRequestState.state;
  if (state !== session.pullRequestState) {
    await sessionStub.fetch(
      new Request("http://do/pr", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }),
    );
  }

  return {
    url: session.pullRequestUrl,
    number: session.pullRequestNumber,
    state,
    merged: pullRequestState.merged,
  };
}
