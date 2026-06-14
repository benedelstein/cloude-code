import type { Logger } from "@repo/shared";
import type {
  GitProxyRepoPolicyProvider,
  GitProxySecretProvider,
  GitProxyTokenProvider,
} from "./git.providers";

export interface GitProxyServiceDeps {
  tokenProvider: GitProxyTokenProvider;
  secretProvider: GitProxySecretProvider;
  repoPolicyProvider: GitProxyRepoPolicyProvider;
  logger: Logger;
}

export interface GitProxyResult {
  response: Response;
  pushedBranch: string | null;
}

export class GitProxyService {
  private readonly tokenProvider: GitProxyTokenProvider;
  private readonly secretProvider: GitProxySecretProvider;
  private readonly repoPolicyProvider: GitProxyRepoPolicyProvider;
  private readonly logger: Logger;

  constructor(deps: GitProxyServiceDeps) {
    this.tokenProvider = deps.tokenProvider;
    this.secretProvider = deps.secretProvider;
    this.repoPolicyProvider = deps.repoPolicyProvider;
    this.logger = deps.logger.scope("git-proxy");
  }

  async handleRequest(request: Request, path: string): Promise<GitProxyResult> {
    this.logger.debug("[git-proxy] request", {
      fields: { method: request.method, url: request.url },
    });

    const gitProxySecret = this.secretProvider.getGitProxySecret();
    const authHeader = request.headers.get("Authorization");
    if (!gitProxySecret || authHeader !== `Bearer ${gitProxySecret}`) {
      this.logger.warn("[git-proxy] auth failed", {
        fields: {
          hasSecret: gitProxySecret !== null,
          hasAuthorizationHeader: authHeader !== null,
          authorizationMatched: authHeader === `Bearer ${gitProxySecret}`,
        },
      });
      return this.result("unauthorized", 401);
    }

    const githubPath = this.parseGitHubPath(path);
    if (!githubPath) {
      return this.result("invalid path", 400);
    }

    const repoFullName = this.repoPolicyProvider.getAllowedRepoFullName();
    if (!repoFullName) {
      this.logger.warn("[git-proxy] repo not configured");
      return this.result("repo not configured", 409);
    }

    if (!githubPath.startsWith(`${repoFullName}.git`)) {
      this.logger.warn("[git-proxy] repo not allowed", {
        fields: { githubPath, repoFullName },
      });
      return this.result("repo not allowed", 403);
    }

    if (githubPath.endsWith("/git-receive-pack") && request.method === "POST") {
      const body = await request.arrayBuffer();
      const pushCheck = validatePush(
        new Uint8Array(body),
        this.repoPolicyProvider.getSessionId(),
        this.repoPolicyProvider.getPushedBranch(),
      );
      if (!pushCheck.allowed) {
        this.logger.warn("[git-proxy] push rejected", {
          fields: { reason: pushCheck.reason ?? "unknown" },
        });
        return this.result(`push rejected: ${pushCheck.reason}`, 403);
      }

      const result = await this.forwardToGitHub(githubPath, request, body, repoFullName);
      if (result.response.ok && pushCheck.branch) {
        result.pushedBranch = pushCheck.branch;
      }
      return result;
    }

    return this.forwardToGitHub(githubPath, request, request.body, repoFullName);
  }

  private parseGitHubPath(path: string): string | null {
    const match = path.match(/^\/git-proxy\/[^/]+\/github\.com\/(.+)/);
    return match?.[1] ?? null;
  }

  private async forwardToGitHub(
    githubPath: string,
    originalRequest: Request,
    body: ArrayBuffer | ReadableStream<Uint8Array> | null,
    repoFullName: string,
  ): Promise<GitProxyResult> {
    this.logger.debug("[git-proxy] forwarding to GitHub", {
      fields: { githubPath },
    });

    const tokenResult = await this.tokenProvider.getInstallationTokenForRepo(repoFullName);
    if (!tokenResult.ok) {
      this.logger.warn("[git-proxy] installation token unavailable", {
        fields: {
          code: tokenResult.error.code,
          status: tokenResult.error.status,
          repoFullName,
        },
      });
      return this.result(tokenResult.error.message, tokenResult.error.status);
    }

    const url = new URL(originalRequest.url);
    const targetUrl = `https://github.com/${githubPath}${url.search}`;
    const basicAuth = btoa(`x-access-token:${tokenResult.value}`);
    const headers: Record<string, string> = {
      "User-Agent": "cloude-code-git-proxy",
      "Authorization": `Basic ${basicAuth}`,
    };

    const contentType = originalRequest.headers.get("Content-Type");
    if (contentType) {
      headers["Content-Type"] = contentType;
    }

    try {
      const response = await globalThis.fetch(targetUrl, {
        method: originalRequest.method,
        headers,
        body,
      });

      this.logger.debug("[git-proxy] GitHub response", {
        fields: {
          status: response.status,
          method: originalRequest.method,
          githubPath,
        },
      });
      return { response, pushedBranch: null };
    } catch (error) {
      this.logger.error("[git-proxy] GitHub fetch failed", {
        error,
        fields: { method: originalRequest.method, githubPath },
      });
      return this.result("GitHub request failed", 502);
    }
  }

  private result(message: string, status: number): GitProxyResult {
    return {
      response: new Response(message, { status }),
      pushedBranch: null,
    };
  }
}

function validatePush(
  body: Uint8Array,
  sessionId: string | null,
  lockedBranch: string | null,
): { allowed: boolean; reason?: string; branch?: string } {
  const sessionSuffix = sessionId ? sessionId.slice(0, 4) : null;

  const parsed = parseReceivePackCommands(body);
  if (!parsed.ok) {
    return { allowed: false, reason: parsed.reason };
  }
  if (parsed.refs.length === 0) {
    return { allowed: false, reason: "no ref updates found in push" };
  }

  const headsPrefix = "refs/heads/";
  let detectedBranch: string | undefined;
  for (const ref of parsed.refs) {
    // Only branch updates are allowed; tags and arbitrary refs bypass the
    // branch policy and must be rejected.
    if (!ref.startsWith(headsPrefix)) {
      return { allowed: false, reason: `only branch updates are allowed, got ref '${ref}'` };
    }
    const branch = ref.slice(headsPrefix.length);
    if (!branch.startsWith("cloude/")) {
      return { allowed: false, reason: `branch must start with 'cloude/', got '${branch}'` };
    }
    if (sessionSuffix && !branch.endsWith(sessionSuffix)) {
      return { allowed: false, reason: `branch must end with '${sessionSuffix}', got '${branch}'` };
    }
    // Enforce branch lock: subsequent pushes must target the same branch.
    if (lockedBranch && branch !== lockedBranch) {
      return { allowed: false, reason: `branch locked to '${lockedBranch}', got '${branch}'` };
    }
    // A single push may not target multiple branches at once.
    if (detectedBranch && branch !== detectedBranch) {
      return {
        allowed: false,
        reason: `push targets multiple branches ('${detectedBranch}' and '${branch}')`,
      };
    }
    detectedBranch = branch;
  }
  return { allowed: true, branch: detectedBranch };
}

/**
 * Parses the command list of a git receive-pack request from its pkt-line
 * framing and returns every updated ref.
 *
 * The body is `*PKT-LINE(command) flush-pkt PACK...`. Each pkt-line is prefixed
 * with a 4-hex-digit length covering the prefix itself; `0000` is the flush
 * packet that terminates the command list. We stop at the flush and never read
 * into the packfile, so payload bytes that happen to look like ref-updates
 * cannot smuggle a command past validation. Any framing error fails closed.
 */
function parseReceivePackCommands(
  body: Uint8Array,
): { ok: true; refs: string[] } | { ok: false; reason: string } {
  const decoder = new TextDecoder();
  const refs: string[] = [];
  let offset = 0;

  while (offset + 4 <= body.length) {
    const lengthHex = decoder.decode(body.subarray(offset, offset + 4));
    if (!/^[0-9a-f]{4}$/i.test(lengthHex)) {
      return { ok: false, reason: "malformed pkt-line length" };
    }
    const pktLength = parseInt(lengthHex, 16);

    // Flush packet: end of the command list, packfile follows.
    if (pktLength === 0) {
      return { ok: true, refs };
    }
    // 0001/0002 are delimiter/response-end markers, invalid in a command list.
    if (pktLength < 4) {
      return { ok: false, reason: "unexpected pkt-line marker in command list" };
    }
    if (offset + pktLength > body.length) {
      return { ok: false, reason: "truncated pkt-line in push" };
    }

    let line = decoder.decode(body.subarray(offset + 4, offset + pktLength));
    offset += pktLength;

    // Capabilities are appended to the first command after a NUL byte.
    const nulIndex = line.indexOf("\0");
    if (nulIndex !== -1) {
      line = line.slice(0, nulIndex);
    }
    line = line.replace(/\n$/, "");

    // Pushes from a shallow clone prefix the commands with shallow lines.
    if (line.startsWith("shallow ")) {
      continue;
    }

    const match = line.match(/^[0-9a-f]{40} [0-9a-f]{40} (.+)$/);
    if (!match) {
      return { ok: false, reason: "unparseable ref-update command" };
    }
    refs.push(match[1]!);
  }

  // Ran out of body before the flush packet: the command list was truncated.
  return { ok: false, reason: "push ended without flush packet" };
}
