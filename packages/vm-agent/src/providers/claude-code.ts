/**
 * Claude Code provider for the agent harness.
 */
import { createClaudeCode } from "ai-sdk-provider-claude-code";
import { execSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { buildSystemPromptAppend } from "../system-prompt";
import type { AgentMode, AgentSettings } from "@repo/shared";
import type { AgentProviderConfig, GetModelOptions, ProviderSetupContext, SetupResult, StreamTextExtras } from "../agent-harness";
import { PermissionMode } from "@anthropic-ai/claude-agent-sdk";

type ClaudeSettings = Extract<AgentSettings, { provider: "claude-code" }>;

type ClaudeCredentials = {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
};

function setupClaudeCredentials(emit: ProviderSetupContext["emit"]): void {
  const credentialsJson = process.env.CLAUDE_CREDENTIALS_JSON;
  if (!credentialsJson) {
    throw new Error("Missing CLAUDE_CREDENTIALS_JSON. Claude OAuth credentials are required.");
  }

  let parsed: ClaudeCredentials;
  try {
    parsed = JSON.parse(credentialsJson) as ClaudeCredentials;
  } catch (error) {
    throw new Error("CLAUDE_CREDENTIALS_JSON is not valid JSON.", { cause: error });
  }

  const oauth = parsed.claudeAiOauth;
  if (
    !oauth ||
    typeof oauth.accessToken !== "string" ||
    typeof oauth.refreshToken !== "string" ||
    typeof oauth.expiresAt !== "number" ||
    !Array.isArray(oauth.scopes)
  ) {
    throw new Error("CLAUDE_CREDENTIALS_JSON missing required claudeAiOauth fields.");
  }

  const claudeDir = join(homedir(), ".claude");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, ".credentials.json"), credentialsJson, { mode: 0o600 });
  emit({ type: "debug", message: "Wrote ~/.claude/.credentials.json from CLAUDE_CREDENTIALS_JSON env" });
}

export const claudeCodeProvider: AgentProviderConfig<ClaudeSettings> = {
  async setup(context: ProviderSetupContext<ClaudeSettings>): Promise<SetupResult<ClaudeSettings["model"]>> {
    const { emit, settings, sessionSuffix, args, spriteContext, agentMode: initialAgentMode } = context;

    setupClaudeCredentials(emit);

    let claudeExecutablePath: string;
    try {
      claudeExecutablePath = execSync("which claude", { encoding: "utf-8" }).trim();
      emit({ type: "debug", message: `claude executable path: ${claudeExecutablePath}` });
    } catch (e) {
      throw new Error(`Failed to find claude executable: ${e}`, { cause: e });
    }

    // Track session ID from Claude - updated after first message
    let agentSessionId: string | undefined = args.sessionId;

    const claudeCode = createClaudeCode({
      defaultSettings: {
        pathToClaudeCodeExecutable: claudeExecutablePath,
        cwd: process.cwd(),
        resume: agentSessionId,
        permissionMode: getPermissionMode(initialAgentMode),
        includePartialMessages: false,
        streamingInput: "always",
        persistSession: true,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: buildSystemPromptAppend(sessionSuffix, spriteContext),
        },
        stderr: (data) => {
          emit({ type: "debug", message: `claude-cli stderr: ${data}` });
        },
      },
    });

    const modelId = settings.model;

    return {
      modelId,
      getModel: (id, options: GetModelOptions) => {
        return claudeCode(id, {
          settingSources: ["local", "project", "user"],
          resume: agentSessionId,
          permissionMode: getPermissionMode(options.agentMode),
        });
      },
      getStreamTextExtras: (): StreamTextExtras => ({
        onStepFinish: (step) => {
          const stepSessionId = (
            step.providerMetadata?.["claude-code"] as { sessionId?: string }
          )?.sessionId;
          if (stepSessionId && stepSessionId !== agentSessionId) {
            agentSessionId = stepSessionId;
            emit({
              type: "debug",
              message: `Claude session ID: ${agentSessionId}`,
            });
            emit({ type: "sessionId", sessionId: agentSessionId });
            if (args.sessionId && agentSessionId !== args.sessionId) {
              emit({
                type: "debug",
                message: `Claude session ID mismatch: ${agentSessionId} !== ${args.sessionId}`,
              });
            }
          }
        },
      }),
    };
  },
};

const getPermissionMode = (agentMode: AgentMode): PermissionMode => {
  return agentMode === "plan" ? "plan" : "bypassPermissions";
};
