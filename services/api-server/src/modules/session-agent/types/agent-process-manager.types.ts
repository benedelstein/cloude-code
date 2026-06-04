import type { AgentMode, AgentSettings, DomainError } from "@repo/shared";

export interface AuthCredentialSnapshot {
  files: Array<{
    path: string;
    contents: string;
    mode?: string;
  }>;
  envVars: Record<string, string>;
}

export const AGENT_PROCESS_MANAGER_DOMAIN = "agent_process_manager";

export type SpriteAgentProcessManagerError =
  | DomainError<
      typeof AGENT_PROCESS_MANAGER_DOMAIN,
      "PROVIDER_AUTH_REQUIRED" | "PROVIDER_CREDENTIALS_SYNC_FAILED",
      { provider: AgentSettings["provider"] }
    >
  | DomainError<
      typeof AGENT_PROCESS_MANAGER_DOMAIN,
      "ATTACHMENTS_NOT_FOUND" | "ATTACHMENTS_RESOLUTION_FAILED",
      { attachmentIds: string[] }
    >
  | DomainError<
      typeof AGENT_PROCESS_MANAGER_DOMAIN,
      | "SESSION_NOT_READY"
      | "USER_NOT_FOUND"
      | "INVALID_AGENT_SETTINGS"
      | "SPAWN_FAILED"
      | "TURN_DID_NOT_START",
      Record<string, unknown>
    >;

export type AgentProcessStartEvent =
  | {
      type: "fresh_start_started";
      userMessageId: string;
    }
  | {
      type: "fresh_start_ready";
      userMessageId: string;
      agentProcessId: number;
    }
  | {
      type: "fresh_start_failed";
      userMessageId: string;
      error: SpriteAgentProcessManagerError;
    };

export interface AgentProcessStartReporter {
  handleProcessStartEvent(event: AgentProcessStartEvent): void;
}

export type ProviderCredentialError =
  | DomainError<"provider_credential", "AUTH_REQUIRED" | "REAUTH_REQUIRED", { provider: AgentSettings["provider"] }>
  | DomainError<"provider_credential", "SYNC_FAILED", { provider: AgentSettings["provider"] }>;

export function managerError<Code extends SpriteAgentProcessManagerError["code"]>(
  code: Code,
  message: string,
  details: Record<string, unknown> = {},
): Extract<SpriteAgentProcessManagerError, { code: Code }> {
  return {
    domain: AGENT_PROCESS_MANAGER_DOMAIN,
    code,
    message,
    ...details,
  } as Extract<SpriteAgentProcessManagerError, { code: Code }>;
}

export interface DispatchMessageInput {
  userMessage: {
    id: string;
    content: string | undefined;
    attachmentIds: string[];
  };
  model?: string;
  effort?: string;
  agentMode?: AgentMode;
}

export function mapProviderCredentialError(
  error: ProviderCredentialError,
): Extract<
  SpriteAgentProcessManagerError,
  { code: "PROVIDER_AUTH_REQUIRED" | "PROVIDER_CREDENTIALS_SYNC_FAILED" }
> {
  switch (error.code) {
    case "AUTH_REQUIRED":
    case "REAUTH_REQUIRED":
      return managerError("PROVIDER_AUTH_REQUIRED", error.message, {
        provider: error.provider,
      });
    case "SYNC_FAILED":
      return managerError("PROVIDER_CREDENTIALS_SYNC_FAILED", error.message, {
        provider: error.provider,
      });
    default: {
      const exhaustiveCheck: never = error;
      throw new Error(
        `Unhandled provider credential error: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}

type AttachmentResolutionErrorLike =
  | {
      code: "ATTACHMENTS_NOT_FOUND";
      message: string;
      attachmentIds: string[];
    }
  | {
      code: "ATTACHMENTS_RESOLUTION_FAILED";
      message: string;
      attachmentIds: string[];
    };

export function mapAttachmentResolutionError(
  error: AttachmentResolutionErrorLike,
): Extract<
  SpriteAgentProcessManagerError,
  { code: "ATTACHMENTS_NOT_FOUND" | "ATTACHMENTS_RESOLUTION_FAILED" }
> {
  switch (error.code) {
    case "ATTACHMENTS_NOT_FOUND":
      return managerError("ATTACHMENTS_NOT_FOUND", error.message, {
        attachmentIds: error.attachmentIds,
      });
    case "ATTACHMENTS_RESOLUTION_FAILED":
      return managerError("ATTACHMENTS_RESOLUTION_FAILED", error.message, {
        attachmentIds: error.attachmentIds,
      });
    default: {
      const exhaustiveCheck: never = error;
      throw new Error(
        `Unhandled attachment resolution error: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}
