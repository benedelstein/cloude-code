import { GitHubAppService } from "@/lib/github";
import type { Env } from "@/types";
import type { SecretRepository } from "@/durable-objects/repositories/secret-repository";

export interface GitProxyContext {
  gitProxySecret: string | null;
  repoId: string | null;
  sessionId: string | null;
  githubToken: string | null;
  /** Branch name locked after first push (enforces single-branch pushes) */
  pushedBranch: string | null;
  env: Env;
  secretRepository: SecretRepository;
}

export interface GitProxyResult {
  response: Response;
  /** If the token was refreshed, the new token string (caller should cache it) */
  githubToken: string | null;
  /** Branch name extracted from a successful push, or null if not a push */
  pushedBranch: string | null;
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
    console.error(`[git-proxy] auth failed: secret=${context.gitProxySecret ? "set" : "null"}, header=${authHeader ? "present" : "missing"}, match=${authHeader === `Bearer ${context.gitProxySecret}`}`);
    return { response: new Response("unauthorized", { status: 401 }), githubToken: null, pushedBranch: null };
  }

  // Strip the /git-proxy/<sessionId>/ prefix to get github.com/owner/repo.git/...
  const match = path.match(/^\/git-proxy\/[^/]+\/github\.com\/(.+)/);
  if (!match?.[1]) {
    return { response: new Response("invalid path", { status: 400 }), githubToken: null, pushedBranch: null };
  }
  const githubPath = match[1];

  // Enforce: only the configured repo (match with .git suffix to prevent prefix collisions)
  if (context.repoId && !githubPath.startsWith(`${context.repoId}.git`)) {
    return { response: new Response("repo not allowed", { status: 403 }), githubToken: null, pushedBranch: null };
  }

  // Enforce: push only to session branch
  if (githubPath.endsWith("/git-receive-pack") && request.method === "POST") {
    const body = await request.arrayBuffer();
    const pushCheck = validatePush(new Uint8Array(body), context.sessionId, context.pushedBranch);
    if (!pushCheck.allowed) {
      return {
        response: new Response(`push rejected: ${pushCheck.reason}`, { status: 403 }),
        githubToken: null,
        pushedBranch: null,
      };
    }
    const result = await forwardToGitHub(githubPath, request, body, context);
    // If push succeeded, propagate the branch name
    if (result.response.ok && pushCheck.branch) {
      result.pushedBranch = pushCheck.branch;
    }
    return result;
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

  const url = new URL(originalRequest.url);
  const targetUrl = `https://github.com/${githubPath}${url.search}`;

  // Use Authorization header instead of URL credentials — Workers' fetch() strips
  // credentials from URLs (user:pass@host), which causes 401 on private repos.
  const basicAuth = btoa(`x-access-token:${githubToken}`);
  const headers: Record<string, string> = {
    "User-Agent": "cloude-code-git-proxy",
    "Authorization": `Basic ${basicAuth}`,
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

  console.log(`[git-proxy] GitHub response: ${response.status} for ${originalRequest.method} ${githubPath}`);
  return { response, githubToken, pushedBranch: null };
}

function validatePush(
  body: Uint8Array,
  sessionId: string | null,
  lockedBranch: string | null,
): { allowed: boolean; reason?: string; branch?: string } {
  const sessionSuffix = sessionId ? sessionId.slice(0, 4) : null;

  // Git pkt-line format: "oldsha newsha refs/heads/branch\0capabilities..."
  const preamble = new TextDecoder().decode(body.slice(0, 2048));
  const refPattern = /[0-9a-f]{40} [0-9a-f]{40} refs\/heads\/(\S+)/g;
  let match;
  let detectedBranch: string | undefined;
  while ((match = refPattern.exec(preamble)) !== null) {
    const branch = match[1]!;
    if (!branch.startsWith("cloude/")) {
      return { allowed: false, reason: `branch must start with 'cloude/', got '${branch}'` };
    }
    if (sessionSuffix && !branch.endsWith(sessionSuffix)) {
      return { allowed: false, reason: `branch must end with '${sessionSuffix}', got '${branch}'` };
    }
    // Enforce branch lock: subsequent pushes must target the same branch
    if (lockedBranch && branch !== lockedBranch) {
      return { allowed: false, reason: `branch locked to '${lockedBranch}', got '${branch}'` };
    }
    detectedBranch = branch;
  }
  return { allowed: true, branch: detectedBranch };
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
