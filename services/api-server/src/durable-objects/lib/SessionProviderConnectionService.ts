import type { ClientState, Logger } from "@repo/shared";
import type { Env } from "@/types";
import { getProviderAuthService } from "@/lib/providers/provider-auth-service";
import type { ServerState } from "../repositories/server-state-repository";

export interface SessionProviderConnectionServiceDeps {
  logger: Logger;
  env: Env;

  getServerState: () => ServerState;
  getClientState: () => ClientState;
  updatePartialState: (partial: Partial<ClientState>) => void;
}

/**
 * Owns resolving and refreshing the session's provider connection state
 * (e.g. Claude, Codex auth status) from the provider auth service.
 */
export class SessionProviderConnectionService {
  private readonly logger: Logger;
  private readonly env: Env;
  private readonly getServerState: () => ServerState;
  private readonly getClientState: () => ClientState;
  private readonly updatePartialState: SessionProviderConnectionServiceDeps["updatePartialState"];

  constructor(deps: SessionProviderConnectionServiceDeps) {
    this.logger = deps.logger.scope("session-provider-connection");
    this.env = deps.env;
    this.getServerState = deps.getServerState;
    this.getClientState = deps.getClientState;
    this.updatePartialState = deps.updatePartialState;
  }

  /**
   * Resolves the current connection state for a provider. Returns a
   * "disconnected" shape when no userId is available, and null when the
   * provider auth service throws.
   */
  async resolveState(
    providerId: ClientState["agentSettings"]["provider"],
    userId: string | null,
  ): Promise<ClientState["providerConnection"]> {
    if (!userId) {
      return {
        provider: providerId,
        connected: false,
        requiresReauth: false,
      };
    }

    try {
      const service = getProviderAuthService(providerId, this.env, this.logger);
      const status = await service.getConnectionStatus(userId);
      return {
        provider: providerId,
        connected: status.connected,
        requiresReauth: status.requiresReauth,
      };
    } catch (error) {
      this.logger.error("Failed to resolve provider connection state", {
        error,
        fields: { provider: providerId, userId },
      });
      return null;
    }
  }

  /**
   * Refreshes the active session provider connection state from the provider
   * auth service, using the current client/server state as inputs.
   */
  async refresh(): Promise<void> {
    const providerConnection = await this.resolveState(
      this.getClientState().agentSettings.provider,
      this.getServerState().userId,
    );
    if (providerConnection) {
      this.updatePartialState({ providerConnection });
    }
  }

  /** Fire-and-forget refresh; logs if it fails. */
  queueRefresh(): void {
    this.refresh().catch((error) => {
      this.logger.error("Failed to refresh provider connection state", { error });
    });
  }
}
