/**
 * Codex CLI provider for the agent harness.
 */
import { createCodexAppServer } from "ai-sdk-provider-codex-cli";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { buildSystemPromptAppend } from "../system-prompt";
import type { SessionSettings } from "@repo/shared";
import type { AgentProviderConfig, ProviderSetupContext, SetupResult } from "../agent-harness";

type CodexSettings = Extract<SessionSettings, { provider: "codex-cli" }>;

function setupCodexAuth(emit: ProviderSetupContext["emit"]): void {
  const authJson = process.env.CODEX_AUTH_JSON;
  if (authJson) {
    const codexDir = join(homedir(), ".codex");
    if (!existsSync(codexDir)) {
      mkdirSync(codexDir, { recursive: true });
    }
    writeFileSync(join(codexDir, "auth.json"), authJson, { mode: 0o600 });
    emit({ type: "debug", message: "Wrote ~/.codex/auth.json from CODEX_AUTH_JSON env" });
  } else if (process.env.OPENAI_API_KEY) {
    emit({ type: "debug", message: "Using OPENAI_API_KEY for codex authentication" });
  } else {
    throw new Error("No codex authentication found. Set CODEX_AUTH_JSON or OPENAI_API_KEY.");
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

    const provider = createCodexAppServer({
      defaultSettings: {
        minCodexVersion: "0.104.0",
        autoApprove: true,
        sandboxPolicy: "workspace-write",
        personality: "pragmatic",
        baseInstructions: systemPromptAppend,
        codexPath,
        resume: args.sessionId,
      },
    });

    emit({ type: "debug", message: `Codex app-server provider initialized (model: ${modelId})` });

    return {
      modelId,
      getModel: (id) => provider(id),
      // TODO: CAPTURE SESSION ID from extras.
      cleanup: async () => {
        await provider.close();
      },
    };
  },
};
