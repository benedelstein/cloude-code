import type { Logger, SessionEnvironmentSnapshot } from "@repo/shared";
import type { Env } from "@/shared/types";
import { decrypt } from "@/shared/utils/crypto";
import {
  ConnectorProxyService,
  type ResolvedConnector,
} from "@/shared/integrations/connector/connector-proxy.service";
import type { SecretRepository } from "../repositories/secret.repository";

export interface SessionConnectorProxyServiceDeps {
  logger: Logger;
  env: Env;
  secretRepository: SecretRepository;
  getEnvironmentSnapshot: () => SessionEnvironmentSnapshot;
}

/**
 * Session-scoped adapter around the agnostic `ConnectorProxyService`. Owns the
 * per-session connector bearer secret (persisted via `SecretRepository`) and
 * resolves connector ids against the session's environment snapshot, decrypting
 * the stored key only at request time.
 */
export class SessionConnectorProxyService {
  private readonly env: Env;
  private readonly secretRepository: SecretRepository;
  private readonly getEnvironmentSnapshot: () => SessionEnvironmentSnapshot;
  private readonly connectorProxyService: ConnectorProxyService;
  private connectorSecret: string | null;

  constructor(deps: SessionConnectorProxyServiceDeps) {
    this.env = deps.env;
    this.secretRepository = deps.secretRepository;
    this.getEnvironmentSnapshot = deps.getEnvironmentSnapshot;
    this.connectorSecret = this.secretRepository.get("connector_proxy_secret");
    this.connectorProxyService = new ConnectorProxyService({
      getConnectorSecret: () => this.connectorSecret,
      resolveConnector: (connectorId) => this.resolveConnector(connectorId),
      logger: deps.logger,
    });
  }

  /** Returns the cached connector secret, generating and persisting it if missing. */
  ensureConnectorSecret(): string {
    if (!this.connectorSecret) {
      this.connectorSecret = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
      this.secretRepository.set("connector_proxy_secret", this.connectorSecret);
    }
    return this.connectorSecret;
  }

  getConnectorSecret(): string | null {
    return this.connectorSecret;
  }

  async handleRequest(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    return this.connectorProxyService.handleRequest(request, path);
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
