import { GitHubAppService } from "@/lib/github";
import type { Env } from "@/types";
import type { SecretRepository } from "@/durable-objects/repositories/secret-repository";

export interface GitProxyContext {
  gitProxySecret: string | null;
  repoId: string | null;
  githubBranchName: string | null;
  githubToken: string | null;
  env: Env;
  secretRepository: SecretRepository;
}

export interface GitProxyResult {
  response: Response;
  /** If the token was refreshed, the new token string (caller should cache it) */
  githubToken: string | null;
}

export async function handleGitProxy(
  request: Request,
  path: string,
  context: GitProxyContext,
): Promise<GitProxyResult> {
  console.log(`[git-proxy] request: ${request.method} ${request.url}`);

  // Authenticate: check Bearer token matches session secret
  const authHeader = request.headers.get("Authorization");
  if (!context.gitProxySecret || authHeader !== `Bearer ${context.gitProxySecret}`) {
    console.error(`[git-proxy] authorization header missing or invalid`);
    return { response: new Response("unauthorized", { status: 401 }), githubToken: null };
  }

  // Strip the /git-proxy/<sessionId>/ prefix to get github.com/owner/repo.git/...
  const match = path.match(/^\/git-proxy\/[^/]+\/github\.com\/(.+)/);
  if (!match?.[1]) {
    return { response: new Response("invalid path", { status: 400 }), githubToken: null };
  }
  const githubPath = match[1];

  // Enforce: only the configured repo (match with .git suffix to prevent prefix collisions)
  if (context.repoId && !githubPath.startsWith(`${context.repoId}.git`)) {
    return { response: new Response("repo not allowed", { status: 403 }), githubToken: null };
  }

  // Enforce: push only to session branch
  if (githubPath.endsWith("/git-receive-pack") && request.method === "POST") {
    const body = await request.arrayBuffer();
    const pushCheck = validatePush(new Uint8Array(body), context.githubBranchName);
    if (!pushCheck.allowed) {
      return {
        response: new Response(`push rejected: ${pushCheck.reason}`, { status: 403 }),
        githubToken: null,
      };
    }
    return forwardToGitHub(githubPath, request, body, context);
  }

  // Read operations (clone, fetch, pull) — always forward
  return forwardToGitHub(githubPath, request, request.body, context);
}

async function forwardToGitHub(
  githubPath: string,
  originalRequest: Request,
  body: ArrayBuffer | ReadableStream<Uint8Array> | null,
  context: GitProxyContext,
): Promise<GitProxyResult> {
  console.log(`[git-proxy] forwarding to GitHub: ${githubPath}`);
  const githubToken = await ensureValidToken(context);
  console.log(`[git-proxy] token: ${githubToken ? githubToken : "null"}`);

  const url = new URL(originalRequest.url);
  const targetUrl = `https://x-access-token:${githubToken}@github.com/${githubPath}${url.search}`;

  const headers: Record<string, string> = {
    "User-Agent": "cloude-code-git-proxy",
  };

  const contentType = originalRequest.headers.get("Content-Type");
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const response = await fetch(targetUrl, {
    method: originalRequest.method,
    headers,
    body,
  });

  return { response, githubToken };
}

function validatePush(
  body: Uint8Array,
  allowedBranch: string | null,
): { allowed: boolean; reason?: string } {
  if (!allowedBranch) return { allowed: true };

  // Git pkt-line format: "oldsha newsha refs/heads/branch\0capabilities..."
  const preamble = new TextDecoder().decode(body.slice(0, 2048));
  const refPattern = /[0-9a-f]{40} [0-9a-f]{40} refs\/heads\/(\S+)/g;
  let match;
  while ((match = refPattern.exec(preamble)) !== null) {
    if (match[1] !== allowedBranch) {
      return { allowed: false, reason: `only '${allowedBranch}' allowed, got '${match[1]}'` };
    }
  }
  return { allowed: true };
}

/**
 * Ensures a valid GitHub token is available, refreshing if needed.
 * Returns the (possibly refreshed) token and persists it to the secret repository.
 */
export async function ensureValidToken(context: GitProxyContext): Promise<string | null> {
  if (!context.repoId) return context.githubToken;

  // GitHubAppService handles caching with a 5-minute buffer before expiry
  const github = new GitHubAppService(context.env);
  const token = await github.getTokenForRepo(context.repoId);
  context.secretRepository.set("github_token", token);
  return token;
}
