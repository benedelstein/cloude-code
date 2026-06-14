import type { Logger, SessionEnvironmentSnapshot } from "@repo/shared";
import type { Env } from "@/shared/types";
import { decrypt, timingSafeCompare } from "@/shared/utils/crypto";
import {
  ConnectorProxyService,
  type ConnectorAuthResult,
  type ResolvedConnector,
} from "@/shared/integrations/connector/connector-proxy.service";
import type { SecretRepository } from "../repositories/secret.repository";

/** How long a connector grant is valid before the sprite must be re-provisioned. */
const CONNECTOR_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A connector grant is the Durable Object's attestation that a specific sprite
 * may inject connector secrets. The on-sprite proxy presents `token`; the DO
 * validates it is unexpired, unrevoked, and (after first use) coming from the
 * same source. The token is bearer-equivalent for *use*, so the value is in
 * binding + revocation, not in the token being unguessable on the sprite.
 */
interface ConnectorGrant {
  token: string;
  expiresAt: number;
  /** Source IP pinned on first use (trust-on-first-use). */
  pinnedIp: string | null;
}

export interface SessionConnectorProxyServiceDeps {
  logger: Logger;
  env: Env;
  secretRepository: SecretRepository;
  getEnvironmentSnapshot: () => SessionEnvironmentSnapshot;
}

/**
 * Session-scoped adapter around the agnostic `ConnectorProxyService`. Owns the
 * per-session connector grant (persisted via `SecretRepository`) and resolves
 * connector ids against the session's environment snapshot, decrypting the
 * stored key only at request time.
 */
export class SessionConnectorProxyService {
  private readonly logger: Logger;
  private readonly env: Env;
  private readonly secretRepository: SecretRepository;
  private readonly getEnvironmentSnapshot: () => SessionEnvironmentSnapshot;
  private readonly connectorProxyService: ConnectorProxyService;
  private grant: ConnectorGrant | null;

  constructor(deps: SessionConnectorProxyServiceDeps) {
    this.logger = deps.logger.scope("session-connector-proxy");
    this.env = deps.env;
    this.secretRepository = deps.secretRepository;
    this.getEnvironmentSnapshot = deps.getEnvironmentSnapshot;
    this.grant = this.loadGrant();
    this.connectorProxyService = new ConnectorProxyService({
      authorize: (token, sourceIp) => this.authorize(token, sourceIp),
      resolveConnector: (connectorId) => this.resolveConnector(connectorId),
      logger: deps.logger,
    });
  }

  /**
   * Returns the current grant token, minting a fresh grant if none exists or the
   * existing one has expired. Called during provisioning to stamp the token into
   * the on-sprite proxy config.
   */
  ensureConnectorToken(): string {
    if (!this.grant || Date.now() > this.grant.expiresAt) {
      this.grant = {
        token: crypto.randomUUID() + crypto.randomUUID().replace(/-/g, ""),
        expiresAt: Date.now() + CONNECTOR_GRANT_TTL_MS,
        pinnedIp: null,
      };
      this.persistGrant();
    }
    return this.grant.token;
  }

  /** Revokes the grant so no further injection is possible. Called on session teardown. */
  revokeConnectorGrant(): void {
    this.grant = null;
    this.secretRepository.delete("connector_grant");
  }

  async handleRequest(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    return this.connectorProxyService.handleRequest(request, path);
  }

  private authorize(token: string | null, sourceIp: string | null): ConnectorAuthResult {
    const grant = this.grant;
    if (!grant) {
      return { ok: false, status: 401, reason: "no active grant" };
    }
    if (!token || !timingSafeCompare(token, grant.token)) {
      return { ok: false, status: 401, reason: "token mismatch" };
    }
    if (Date.now() > grant.expiresAt) {
      return { ok: false, status: 401, reason: "grant expired" };
    }
    if (grant.pinnedIp === null) {
      // Trust-on-first-use: pin the first source we see for this grant.
      if (sourceIp) {
        grant.pinnedIp = sourceIp;
        this.persistGrant();
      }
    } else if (sourceIp && sourceIp !== grant.pinnedIp) {
      return { ok: false, status: 403, reason: "source mismatch" };
    }
    return { ok: true };
  }

  private loadGrant(): ConnectorGrant | null {
    const raw = this.secretRepository.get("connector_grant");
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as ConnectorGrant;
    } catch (error) {
      this.logger.warn("Failed to parse connector grant; ignoring", { error });
      return null;
    }
  }

  private persistGrant(): void {
    if (this.grant) {
      this.secretRepository.set("connector_grant", JSON.stringify(this.grant));
    }
  }

  private async resolveConnector(
    connectorId: string,
  ): Promise<ResolvedConnector | null> {
    const connector = this.getEnvironmentSnapshot().connectors.find(
      (entry) => entry.id === connectorId,
    );
    if (!connector) {
      return null;
    }
    const key = await decrypt(connector.encryptedKey, this.env.TOKEN_ENCRYPTION_KEY);
    return {
      id: connector.id,
      upstreamBaseUrl: connector.upstreamBaseUrl,
      headerName: connector.headerName,
      headerValuePrefix: connector.headerValuePrefix,
      key,
    };
  }
}
