/**
 * Codex CLI provider for the agent harness.
 */
import { createCodexAppServer } from "ai-sdk-provider-codex-cli";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { buildSystemPromptAppend } from "../system-prompt";
import type { AgentSettings } from "@repo/shared";
import type { AgentProviderConfig, GetModelOptions, ProviderSetupContext, SetupResult, StreamTextExtras } from "../agent-harness";

type CodexSettings = Extract<AgentSettings, { provider: "codex-cli" }>;

function setupCodexAuth(emit: ProviderSetupContext["emit"]): void {
  const authJson = process.env.CODEX_AUTH_JSON;
  if (authJson) {
    const codexDir = join(homedir(), ".codex");
    if (!existsSync(codexDir)) {
      mkdirSync(codexDir, { recursive: true });
    }
    writeFileSync(join(codexDir, "auth.json"), authJson, { mode: 0o600 });
    emit({ type: "debug", message: "Wrote ~/.codex/auth.json from CODEX_AUTH_JSON env" });
  } else {
    throw new Error("No codex authentication found. Set CODEX_AUTH_JSON.");
  }
}

export const codexProvider: AgentProviderConfig<CodexSettings> = {
  async setup(context: ProviderSetupContext<CodexSettings>): Promise<SetupResult<CodexSettings["model"]>> {
    const { emit, settings, sessionSuffix, args, spriteContext } = context;

    setupCodexAuth(emit);

    const systemPromptAppend = buildSystemPromptAppend(sessionSuffix, spriteContext);

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
        sandboxPolicy: "workspace-write",
        personality: "pragmatic",
        baseInstructions: systemPromptAppend,
        codexPath,
        threadMode: "persistent",
        resume: agentSessionId,
      },
    });

    emit({ type: "debug", message: `Codex app-server provider initialized (model: ${modelId})` });

    // NOTE: codex-app-server in persistent mode automatically resumes thread state
    // even when the model is changed. No need to pass in a thread id. 
    return {
      modelId,
      planMode: false,
      getModel: (id, options?: GetModelOptions) =>
        provider(id, {
          sandboxPolicy: options?.planMode ? "read-only" : "workspace-write",
        }),
      getStreamTextExtras: (): StreamTextExtras => ({
        onStepFinish: (step) => {
          const stepSessionId = (step.providerMetadata?.["codex-app-server"] as { threadId?: string })?.threadId;
          emit({ type: "debug", message: `Codex step session ID: ${stepSessionId}` });
          if (stepSessionId && stepSessionId !== agentSessionId) {
            agentSessionId = stepSessionId;
            emit({ type: "sessionId", sessionId: agentSessionId });
            if (args.sessionId && agentSessionId !== args.sessionId) {
              emit({ type: "debug", message: `Codex session ID mismatch: ${agentSessionId} !== ${args.sessionId}` });
            }
          }
        },
      }),
      cleanup: async () => {
        await provider.close();
      },
    };
  },
};
