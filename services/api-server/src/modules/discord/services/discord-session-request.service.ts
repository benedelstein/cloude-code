import { createAnthropic } from "@ai-sdk/anthropic";
import {
  type CreateSessionRequest,
  type DiscordRepoCandidate,
  type DiscordSessionResponse,
  type Repo,
  dedent,
} from "@repo/shared";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import type {
  DiscordRepoResolution,
  DiscordRepoRoutingCandidate,
  DiscordSessionRequestDeps,
  DiscordSessionRequestPayload,
} from "../types/discord.types";

const logger = createLogger("discord-session-request.service.ts");
const MAX_REPOS_TO_ROUTE = 300;
const MAX_ROUTING_CANDIDATES = 20;
const MAX_README_CANDIDATES = 8;
const MAX_README_CHARS = 1800;
const MIN_LLM_CONFIDENCE = 0.55;
const MIN_HEURISTIC_SCORE = 8;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "auth",
  "bot",
  "change",
  "code",
  "create",
  "fix",
  "for",
  "in",
  "make",
  "of",
  "on",
  "please",
  "repo",
  "repository",
  "the",
  "to",
  "update",
  "with",
]);

const repoRoutingSchema = z.object({
  selectedRepoId: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(200).optional(),
});

const REPO_ROUTER_SYSTEM_PROMPT = dedent`
  You route a Discord request to exactly one GitHub repository.
  Choose from the provided candidates only.
  Use repository names, owner/name, descriptions, and README excerpts.
  If the request names a repo alias, prefer the repository whose name best matches that alias.
  Return null when no candidate is a plausible match or when multiple candidates are equally plausible.
`;

export class DiscordSessionRequestService {
  private readonly env: Env;
  private readonly deps: DiscordSessionRequestDeps;

  constructor(env: Env, deps: DiscordSessionRequestDeps) {
    this.env = env;
    this.deps = deps;
  }

  /**
   * Resolves the Discord user, routes the prompt to a repository, and creates
   * a Cloude session with the prompt as the initial user message.
   */
  async createSessionFromDiscord(params: {
    request: DiscordSessionRequestPayload;
    executionCtx: ExecutionContext;
  }): Promise<DiscordSessionResponse> {
    const userId = this.resolveMappedUserId(params.request.discordUserId);
    if (!userId) {
      return {
        ok: false,
        code: "DISCORD_NOT_LINKED",
        message: "This Discord user is not mapped to a Cloude account.",
      };
    }

    const githubAccessToken = await this.deps.tokenProvider.getValidGitHubAccessTokenByUserId(userId);
    if (!githubAccessToken) {
      return {
        ok: false,
        code: "GITHUB_AUTH_REQUIRED",
        message: "The mapped Cloude account needs to sign in with GitHub again.",
      };
    }

    const reposResult = await this.deps.repoCandidateProvider.listAccessibleRepos({
      userId,
      githubAccessToken,
      executionCtx: params.executionCtx,
      limit: MAX_REPOS_TO_ROUTE,
    });
    if (!reposResult.ok) {
      return {
        ok: false,
        code: "NO_REPO_MATCH",
        message: reposResult.error.message,
      };
    }

    const resolution = await this.resolveRepository({
      prompt: params.request.prompt,
      repos: reposResult.value,
      githubAccessToken,
    });
    if (!resolution) {
      const candidates = this.rankRepos(params.request.prompt, reposResult.value)
        .slice(0, 5)
        .map(toDiscordRepoCandidate);
      return {
        ok: false,
        code: candidates.length > 0 ? "AMBIGUOUS_REPO_MATCH" : "NO_REPO_MATCH",
        message: candidates.length > 0
          ? "I could not confidently choose a repository. Include owner/repo or the exact repo name."
          : "I could not find a repository match for that request.",
        candidates,
      };
    }

    const sessionResult = await this.deps.sessionCreator.createSession({
      userId,
      githubAccessToken,
      request: this.buildCreateSessionRequest(params.request, resolution.repo),
    });
    if (!sessionResult.ok) {
      return {
        ok: false,
        code: "SESSION_CREATE_FAILED",
        message: sessionResult.error.message,
      };
    }

    return {
      ok: true,
      sessionId: sessionResult.value.sessionId,
      title: sessionResult.value.title,
      repoId: resolution.repo.id,
      repoFullName: resolution.repo.fullName,
      sessionUrl: this.buildSessionUrl(sessionResult.value.sessionId),
      routingReason: resolution.reason,
    };
  }

  private buildCreateSessionRequest(
    request: DiscordSessionRequestPayload,
    repo: DiscordRepoRoutingCandidate,
  ): CreateSessionRequest {
    const prefix = request.discordUsername
      ? `Discord request from ${request.discordUsername}:`
      : "Discord request:";
    return {
      repoId: repo.id,
      initialMessage: {
        content: `${prefix}\n\n${request.prompt}`,
      },
    };
  }

  private buildSessionUrl(sessionId: string): string | undefined {
    const origin = this.env.WEB_ORIGIN?.replace(/\/$/, "");
    return origin ? `${origin}/session/${sessionId}` : undefined;
  }

  private resolveMappedUserId(discordUserId: string): string | null {
    const mapJson = this.env.DISCORD_USER_MAP_JSON;
    if (!mapJson) {
      logger.warn("Discord user map is not configured");
      return null;
    }

    try {
      const parsed = z.record(z.string(), z.string().uuid()).parse(JSON.parse(mapJson));
      return parsed[discordUserId] ?? null;
    } catch (error) {
      logger.error("Discord user map is invalid", { error });
      return null;
    }
  }

  private async resolveRepository(params: {
    prompt: string;
    repos: Repo[];
    githubAccessToken: string;
  }): Promise<DiscordRepoResolution | null> {
    const directMatch = findDirectRepoReference(params.prompt, params.repos);
    if (directMatch) {
      return {
        repo: { ...directMatch, score: Number.MAX_SAFE_INTEGER },
        reason: "Matched explicit repository name.",
      };
    }

    const candidates = this.rankRepos(params.prompt, params.repos)
      .slice(0, MAX_ROUTING_CANDIDATES);
    if (candidates.length === 0) {
      return null;
    }

    const enrichedCandidates = await this.addReadmeExcerpts({
      candidates,
      githubAccessToken: params.githubAccessToken,
    });
    const llmResolution = await this.resolveRepositoryWithLlm({
      prompt: params.prompt,
      candidates: enrichedCandidates,
    });
    if (llmResolution) {
      return llmResolution;
    }

    const [first, second] = candidates;
    if (first && first.score >= MIN_HEURISTIC_SCORE && (!second || first.score > second.score * 1.8)) {
      return {
        repo: first,
        reason: "Matched repository name and description keywords.",
      };
    }

    return null;
  }

  private rankRepos(prompt: string, repos: Repo[]): DiscordRepoRoutingCandidate[] {
    const normalizedPrompt = normalizeText(prompt);
    const tokens = tokenize(prompt);

    return repos
      .map((repo) => ({ ...repo, score: scoreRepo(repo, normalizedPrompt, tokens) }))
      .filter((repo) => repo.score > 0)
      .sort((left, right) => right.score - left.score || left.fullName.localeCompare(right.fullName));
  }

  private async addReadmeExcerpts(params: {
    candidates: DiscordRepoRoutingCandidate[];
    githubAccessToken: string;
  }): Promise<DiscordRepoRoutingCandidate[]> {
    const enriched = [...params.candidates];
    const readmeCandidates = enriched.slice(0, MAX_README_CANDIDATES);
    const excerpts = await Promise.all(readmeCandidates.map((repo) =>
      this.deps.repoCandidateProvider.getReadmeExcerpt({
        githubAccessToken: params.githubAccessToken,
        repo,
        maxChars: MAX_README_CHARS,
      }),
    ));

    for (let index = 0; index < excerpts.length; index += 1) {
      const excerpt = excerpts[index];
      if (excerpt) {
        enriched[index] = { ...enriched[index]!, readmeExcerpt: excerpt };
      }
    }
    return enriched;
  }

  private async resolveRepositoryWithLlm(params: {
    prompt: string;
    candidates: DiscordRepoRoutingCandidate[];
  }): Promise<DiscordRepoResolution | null> {
    try {
      const anthropic = createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
      const result = await generateText({
        model: anthropic("claude-haiku-4-5-20251001"),
        output: Output.object({ schema: repoRoutingSchema }),
        maxOutputTokens: 180,
        system: REPO_ROUTER_SYSTEM_PROMPT,
        prompt: buildRoutingPrompt(params.prompt, params.candidates),
      });
      const selectedRepoId = result.output.selectedRepoId;
      if (!selectedRepoId || result.output.confidence < MIN_LLM_CONFIDENCE) {
        return null;
      }

      const repo = params.candidates.find((candidate) => candidate.id === selectedRepoId);
      if (!repo) {
        return null;
      }

      return {
        repo,
        reason: result.output.reason,
      };
    } catch (error) {
      logger.warn("Failed to route Discord request via LLM", { error });
      return null;
    }
  }
}

function buildRoutingPrompt(
  prompt: string,
  candidates: DiscordRepoRoutingCandidate[],
): string {
  const candidateText = candidates.map((candidate) => dedent`
    - repoId: ${candidate.id}
      fullName: ${candidate.fullName}
      description: ${candidate.description ?? ""}
      heuristicScore: ${candidate.score}
      readmeExcerpt: ${candidate.readmeExcerpt ?? ""}
  `).join("\n");

  return dedent`
    User request:
    ${prompt}

    Candidate repositories:
    ${candidateText}
  `;
}

function findDirectRepoReference(prompt: string, repos: Repo[]): Repo | null {
  const normalizedPrompt = normalizeText(prompt);
  return repos.find((repo) => {
    const fullName = normalizeText(repo.fullName);
    return normalizedPrompt.includes(fullName);
  }) ?? null;
}

function scoreRepo(repo: Repo, normalizedPrompt: string, tokens: Set<string>): number {
  const normalizedName = normalizeText(repo.name);
  const normalizedFullName = normalizeText(repo.fullName);
  const normalizedDescription = normalizeText(repo.description ?? "");
  let score = 0;

  if (normalizedPrompt.includes(normalizedFullName)) {
    score += 100;
  }
  if (normalizedPrompt.includes(normalizedName)) {
    score += 40;
  }

  for (const token of tokens) {
    if (normalizedName.split(" ").includes(token)) {
      score += 12;
    } else if (normalizedName.includes(token)) {
      score += 8;
    }
    if (normalizedFullName.includes(token)) {
      score += 4;
    }
    if (normalizedDescription.includes(token)) {
      score += 2;
    }
  }

  return score;
}

function tokenize(value: string): Set<string> {
  const normalized = normalizeText(value);
  return new Set(normalized.split(" ").filter((token) => (
    token.length > 1 && !STOP_WORDS.has(token)
  )));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9/._-]+/g, " ").trim();
}

function toDiscordRepoCandidate(repo: DiscordRepoRoutingCandidate): DiscordRepoCandidate {
  return {
    repoId: repo.id,
    repoFullName: repo.fullName,
    reason: repo.description ?? undefined,
  };
}
