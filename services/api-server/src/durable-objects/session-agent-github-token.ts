import { GitHubAppService } from "@/lib/github";
import { logger } from "@/lib/logger";
import type { Env } from "@/types";
import type { SecretRepository } from "./repositories/secret-repository";

export interface GitHubTokenContext {
  repoFullName: string | null;
  githubToken: string | null;
  env: Env;
  secretRepository: SecretRepository;
}

/**
 * Ensures a valid GitHub installation token is available, refreshing if needed.
 * Returns the (possibly refreshed) token and persists it to the secret repository.
 */
export async function ensureValidInstallationToken(context: GitHubTokenContext): Promise<string | null> {
  if (!context.repoFullName) return context.githubToken;

  // GitHubAppService handles caching with a 5-minute buffer before expiry
  const github = new GitHubAppService(context.env, logger);
  const token = await github.getInstallationTokenForRepo(context.repoFullName);
  context.secretRepository.set("github_token", token);
  return token;
}
