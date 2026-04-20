/**
 * Claude Code provider for the agent harness.
 */
import { createClaudeCode } from "ai-sdk-provider-claude-code";
import { execSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { buildSystemPromptAppend, getTodoToolNameForProvider } from "../system-prompt";
import type { AgentMode, AgentSettings, ClaudeModel } from "@repo/shared";
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
    // In production (Sprite VM) CLAUDE_CREDENTIALS_JSON must always be provided.
    // For local dev, set VM_AGENT_LOCAL=1 to fall back to the user's existing
    // ~/.claude/.credentials.json set up by the Claude CLI.
    if (process.env.VM_AGENT_LOCAL === "1") {
      emit({ type: "debug", message: "VM_AGENT_LOCAL=1 — using existing ~/.claude/.credentials.json" });
      return;
    }
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
        includePartialMessages: true,
        streamingInput: "always",
        persistSession: true,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: buildSystemPromptAppend(
            sessionSuffix,
            spriteContext,
            getTodoToolNameForProvider(settings.provider),
          ),
        },
        stderr: (data) => {
          emit({ type: "debug", message: `claude-cli stderr: ${data}` });
        },
      },
    });

    const modelId = settings.model;

    const onSessionId = (sid: string | undefined) => {
      if (!sid || sid === agentSessionId) return;
      agentSessionId = sid;
      emit({ type: "debug", message: `Claude session ID: ${sid}` });
      emit({ type: "sessionId", sessionId: sid });
      if (args.sessionId && sid !== args.sessionId) {
        emit({
          type: "debug",
          message: `Claude session ID mismatch: ${sid} !== ${args.sessionId}`,
        });
      }
    };

    return {
      modelId,
      getModel: (id, options: GetModelOptions) => {
        const model = claudeCode(resolveClaudeModelId(id as ClaudeModel), {
          settingSources: ["local", "project", "user"],
          resume: agentSessionId,
          permissionMode: getPermissionMode(options.agentMode),
        });
        return withSessionIdInterceptor(model, onSessionId);
      },
      getStreamTextExtras: (): StreamTextExtras => ({
        onStepFinish: (step) => {
          // Runs at the end of each step. Session ID is usually captured
          // earlier via the setSessionId interceptor; this is a fallback.
          const stepSessionId = (
            step.providerMetadata?.["claude-code"] as { sessionId?: string }
          )?.sessionId;
          onSessionId(stepSessionId);
        },
      }),
    };
  },
};

/**
 * Patches the model's `setSessionId` so we're notified as soon as the provider
 * learns the Claude session ID from the CLI's `system/init` message — well
 * before `onStepFinish` fires, so it survives mid-stream aborts.
 */
function withSessionIdInterceptor<M extends object>(
  model: M,
  onSessionId: (_sid: string) => void,
): M {
  const patched = model as M & { setSessionId: (_sid: string) => void };
  const original = patched.setSessionId.bind(patched);
  patched.setSessionId = (sid: string) => {
    original(sid);
    onSessionId(sid);
  };
  return model;
}

const getPermissionMode = (agentMode: AgentMode): PermissionMode => {
  return agentMode === "plan" ? "plan" : "bypassPermissions";
};

const resolveClaudeModelId = (model: ClaudeModel): string => {
  switch (model) {
    case "opus":
      return "claude-opus-4-6[1m]";
    case "sonnet":
      return "sonnet";
    case "haiku":
      return "haiku";
    default: {
      const _exhaustive: never = model;
      throw new Error(`Unhandled Claude model: ${_exhaustive}`);
    }
  }
};
