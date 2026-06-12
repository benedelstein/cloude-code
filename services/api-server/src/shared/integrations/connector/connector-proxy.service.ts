import type { Logger } from "@repo/shared";
import { timingSafeCompare } from "@/shared/utils/crypto";

/** A connector resolved for a single request, with its secret already decrypted. */
export interface ResolvedConnector {
  id: string;
  /** Real upstream base URL, e.g. https://api.openai.com */
  upstreamBaseUrl: string;
  /** Header the secret is injected into, e.g. "Authorization". */
  headerName: string;
  /** Prefix prepended to the secret to form the header value, e.g. "Bearer ". */
  headerValuePrefix: string;
  /** Decrypted secret. Never logged, never returned to the caller. */
  key: string;
}

export interface ConnectorProxyServiceDeps {
  /** Per-session bearer secret the sprite presents. */
  getConnectorSecret(): string | null;
  /** Resolve a connector id to its config + decrypted key, or null if unknown. */
  resolveConnector(connectorId: string): Promise<ResolvedConnector | null>;
  logger: Logger;
}

/**
 * Worker-side endpoint that the on-sprite proxy forwards intercepted requests
 * to. It authenticates the sprite via a per-session bearer secret, injects the
 * connector's real secret into the configured header, and forwards to the real
 * upstream. The secret never reaches the sprite; the sprite only ever holds the
 * per-session bearer and an opaque connector id.
 *
 * Hardening:
 * - the client-supplied auth header is stripped before injection so a
 *   compromised agent cannot redirect the injected secret elsewhere;
 * - the upstream is fixed by the connector config, so the agent can only cause
 *   the secret to be sent to its intended host.
 */
export class ConnectorProxyService {
  private readonly deps: ConnectorProxyServiceDeps;
  private readonly logger: Logger;

  constructor(deps: ConnectorProxyServiceDeps) {
    this.deps = deps;
    this.logger = deps.logger.scope("connector-proxy");
  }

  async handleRequest(request: Request, path: string): Promise<Response> {
    const secret = this.deps.getConnectorSecret();
    const authHeader = parseBearer(request.headers.get("Authorization"));
    if (!secret || !authHeader || !timingSafeCompare(authHeader, secret)) {
      this.logger.warn("[connector-proxy] auth failed", {
        fields: { hasSecret: secret !== null, hasAuth: authHeader !== null },
      });
      return new Response("unauthorized", { status: 401 });
    }

    const parsed = parseConnectorPath(path);
    if (!parsed) {
      return new Response("invalid path", { status: 400 });
    }

    const connector = await this.deps.resolveConnector(parsed.connectorId);
    if (!connector) {
      this.logger.warn("[connector-proxy] unknown connector", {
        fields: { connectorId: parsed.connectorId },
      });
      return new Response("unknown connector", { status: 404 });
    }

    const targetUrl = buildTargetUrl(connector.upstreamBaseUrl, parsed.rest, request.url);
    if (!targetUrl) {
      return new Response("invalid upstream", { status: 500 });
    }

    const headers = new Headers(request.headers);
    // Drop the sprite's bearer and any client-set value for the injected header
    // so the agent cannot smuggle its own credentials or redirect the secret.
    headers.delete("Authorization");
    headers.delete(connector.headerName);
    headers.delete("Host");
    headers.set(connector.headerName, `${connector.headerValuePrefix}${connector.key}`);

    try {
      const response = await globalThis.fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      });
      this.logger.debug("[connector-proxy] forwarded", {
        fields: {
          connectorId: connector.id,
          method: request.method,
          host: new URL(targetUrl).host,
          status: response.status,
        },
      });
      return response;
    } catch (error) {
      this.logger.error("[connector-proxy] upstream fetch failed", {
        error,
        fields: { connectorId: connector.id },
      });
      return new Response("upstream request failed", { status: 502 });
    }
  }
}

function parseBearer(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() : null;
}

/** Parse `/connector/{sessionId}/{connectorId}/{rest}` → connectorId + rest path ("/..."). */
function parseConnectorPath(
  path: string,
): { connectorId: string; rest: string } | null {
  const match = path.match(/^\/connector\/[^/]+\/([^/]+)(\/.*)?$/);
  if (!match) {
    return null;
  }
  return { connectorId: match[1]!, rest: match[2] ?? "/" };
}

function buildTargetUrl(
  upstreamBaseUrl: string,
  rest: string,
  originalUrl: string,
): string | null {
  try {
    const base = upstreamBaseUrl.replace(/\/+$/, "");
    const search = new URL(originalUrl).search;
    return `${base}${rest}${search}`;
  } catch {
    return null;
  }
}
