/**
 * Codex CLI provider for the agent harness.
 */
import { CodexAppServerSettings, createCodexAppServer } from "ai-sdk-provider-codex-cli";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { buildSystemPromptAppend, getTodoToolNameForProvider } from "../system-prompt";
import type { AgentMode, AgentSettings } from "@repo/shared";
import type { AgentProviderConfig, GetModelOptions, ProviderSetupContext, SetupResult, StreamTextExtras } from "../agent-harness";

type CodexSettings = Extract<AgentSettings, { provider: "openai-codex" }>;

function setupCodexAuth(emit: ProviderSetupContext["emit"]): void {
  const authJson = process.env.CODEX_AUTH_JSON;
  if (!authJson) {
    // In production (Sprite VM) CLAUDE_CREDENTIALS_JSON must always be provided.
    // For local dev, set VM_AGENT_LOCAL=1 to fall back to the user's existing
    // ~/.claude/.credentials.json set up by the Claude CLI.
    if (process.env.VM_AGENT_LOCAL === "1") {
      emit({ type: "debug", message: "VM_AGENT_LOCAL=1 — using existing ~/.claude/.credentials.json" });
      return;
    }
    throw new Error("Missing CODEX_AUTH_JSON. Codex authentication is required.");
  }
  const codexDir = join(homedir(), ".codex");
  if (!existsSync(codexDir)) {
    mkdirSync(codexDir, { recursive: true });
  }
  writeFileSync(join(codexDir, "auth.json"), authJson, { mode: 0o600 });
  emit({ type: "debug", message: "Wrote ~/.codex/auth.json from CODEX_AUTH_JSON env" });
}

export const codexProvider: AgentProviderConfig<CodexSettings> = {
  async setup(context: ProviderSetupContext<CodexSettings>): Promise<SetupResult<CodexSettings["model"]>> {
    const { emit, settings, sessionSuffix, args, spriteContext, agentMode: initialAgentMode } = context;

    setupCodexAuth(emit);

    const systemPromptAppend = buildSystemPromptAppend(
      sessionSuffix,
      spriteContext,
      getTodoToolNameForProvider(settings.provider),
    );

    let codexPath: string | undefined;
    try {
      codexPath = execSync("which codex", { encoding: "utf-8" }).trim();
      emit({ type: "debug", message: `Resolved codex path: ${codexPath}` });
    } catch {
      emit({ type: "debug", message: "Could not resolve codex path via 'which'; using default resolution" });
    }

    const modelId = settings.model;
    let agentSessionId: string | undefined = args.sessionId;

    const provider = createCodexAppServer({
      defaultSettings: {
        minCodexVersion: "0.104.0",
        autoApprove: true,
        sandboxPolicy: getSandboxPolicy(initialAgentMode),
        personality: "pragmatic",
        baseInstructions: systemPromptAppend,
        codexPath,
        threadMode: "persistent",
        resume: agentSessionId,
      },
    });

    emit({ type: "debug", message: `Codex app-server provider initialized (model: ${modelId})` });

    const onSessionId = (sid: string | undefined) => {
      if (!sid || sid === agentSessionId) return;
      agentSessionId = sid;
      emit({ type: "debug", message: `Codex session ID: ${sid}` });
      emit({ type: "sessionId", sessionId: sid });
      if (args.sessionId && sid !== args.sessionId) {
        emit({ type: "debug", message: `Codex session ID mismatch: ${sid} !== ${args.sessionId}` });
      }
    };

    // NOTE: codex-app-server in persistent mode automatically resumes thread state
    // even when the model is changed. No need to pass in a thread id.
    return {
      modelId,
      getModel: (id, options: GetModelOptions) => {
        const model = provider(id, {
          sandboxPolicy: getSandboxPolicy(options.agentMode),
          resume: agentSessionId,
        });
        return withThreadIdInterceptor(model, onSessionId);
      },
      getStreamTextExtras: (): StreamTextExtras => ({
        onStepFinish: (step) => {
          // Runs at the end of each step. Thread ID is usually captured earlier
          // via the doStream interceptor; this is a fallback.
          const stepSessionId = (step.providerMetadata?.["codex-app-server"] as { threadId?: string })?.threadId;
          onSessionId(stepSessionId);
        },
      }),
      cleanup: async () => {
        await provider.close();
      },
    };
  },
};

/**
 * Wraps the model's `doStream` so we read `persistentThreadId` as soon as the
 * underlying `startOrResumeThread` resolves (inside doStream, before streaming
 * begins). This fires well before `onStepFinish` and survives mid-stream aborts.
 */
function withThreadIdInterceptor<M extends object>(
  model: M,
  onSessionId: (_sid: string | undefined) => void,
): M {
  const patched = model as M & {
    doStream: (_opts: unknown) => Promise<unknown>;
    persistentThreadId?: string;
  };
  const original = patched.doStream.bind(patched);
  patched.doStream = async (opts: unknown) => {
    const result = await original(opts);
    onSessionId(patched.persistentThreadId);
    return result;
  };
  return model;
}

const getSandboxPolicy = (agentMode: AgentMode): CodexAppServerSettings["sandboxPolicy"] => {
  return agentMode === "plan" ? "read-only" : "danger-full-access";
};
