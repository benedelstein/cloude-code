import type { Repo } from "@repo/shared";
import type { IntegrationRepoRoutingCandidate } from "../types/integrations.types";

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

/**
 * Scores and sorts repos against a prompt, dropping repos with no signal.
 * Returns candidates ordered by descending score, then full name.
 */
export function rankRepos(prompt: string, repos: Repo[]): IntegrationRepoRoutingCandidate[] {
  const normalizedPrompt = normalizeText(prompt);
  const tokens = tokenize(prompt);

  return repos
    .map((repo) => ({ ...repo, score: scoreRepo(repo, normalizedPrompt, tokens) }))
    .filter((repo) => repo.score > 0)
    .sort((left, right) => right.score - left.score || left.fullName.localeCompare(right.fullName));
}

/** Finds a repo whose normalized owner/name appears verbatim in the prompt. */
export function findDirectRepoReference(prompt: string, repos: Repo[]): Repo | null {
  const normalizedPrompt = normalizeText(prompt);
  return repos.find((repo) => {
    const fullName = normalizeText(repo.fullName);
    return normalizedPrompt.includes(fullName);
  }) ?? null;
}

/** Heuristic relevance score for one repo against the normalized prompt and its tokens. */
export function scoreRepo(repo: Repo, normalizedPrompt: string, tokens: Set<string>): number {
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

/** Splits a prompt into normalized, deduplicated tokens with stop words removed. */
export function tokenize(value: string): Set<string> {
  const normalized = normalizeText(value);
  return new Set(normalized.split(" ").filter((token) => (
    token.length > 1 && !STOP_WORDS.has(token)
  )));
}

/** Lowercases and strips characters that are not meaningful in repo names. */
export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9/._-]+/g, " ").trim();
}
