import { GitHubAppService } from "@/lib/github";
import { createLogger } from "@/lib/logger";
import type { Env } from "@/types";
import type { SecretRepository } from "./repositories/secret-repository";

const logger = createLogger("session-agent-github-token.ts");

export interface GitHubTokenContext {
  repoFullName: string | null;
  githubInstallationToken: string | null;
  env: Env;
  secretRepository: SecretRepository;
}

/**
 * Ensures a valid GitHub installation token is available, refreshing if needed.
 * Returns the (possibly refreshed) token and persists it to the secret repository.
 */
export async function ensureValidInstallationToken(context: GitHubTokenContext): Promise<string | null> {
  if (!context.repoFullName) return context.githubInstallationToken;

  // GitHubAppService handles caching with a 5-minute buffer before expiry
  const github = new GitHubAppService(context.env, logger);
  const tokenResult = await github.getInstallationTokenForRepo(context.repoFullName);
  if (!tokenResult.ok) {
    throw new Error(tokenResult.error.message);
  }
  const token = tokenResult.value;
  context.secretRepository.set("github_token", token);
  return token;
}
