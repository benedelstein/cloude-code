/**
 * Codex CLI provider for the agent harness.
 */
import type { CodexAppServerSettings } from "ai-sdk-provider-codex-cli";
import { createCodexAppServer } from "ai-sdk-provider-codex-cli";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { buildSystemPromptAppend, getTodoToolNameForProvider } from "../lib/system-prompt";
import { OpenAICodexEffort } from "@repo/shared";
import type { AgentMode, AgentSettings } from "@repo/shared";
import type {
  AgentProviderConfig,
  GetModelOptions,
  ProviderSetupContext,
  SetupResult,
  StreamTextExtras,
} from "../lib/agent-harness";

type CodexSettings = Extract<AgentSettings, { provider: "openai-codex" }>;

const DEFAULT_CODEX_MIN_VERSION = "0.144.0";
const CODEX_PATH_CANDIDATES = [
  join(homedir(), ".local", "bin", "codex"),
  join(homedir(), "bin", "codex"),
  "/usr/local/bin/codex",
];

function resolveCodexPath(emit: ProviderSetupContext["emit"]): string | undefined {
  try {
    const codexPath = execSync("command -v codex", { encoding: "utf-8" }).trim();
    if (codexPath) {
      emit({ type: "debug", message: `Resolved codex path: ${codexPath}` });
      return codexPath;
    }
  } catch {
    // Fall through to the install locations used by the Codex bootstrap script.
  }

  for (const candidate of CODEX_PATH_CANDIDATES) {
    if (existsSync(candidate)) {
      emit({ type: "debug", message: `Resolved codex path: ${candidate}` });
      return candidate;
    }
  }

  emit({ type: "debug", message: "Could not resolve codex path; using provider default resolution" });
  return undefined;
}

function setupCodexAuth(emit: ProviderSetupContext["emit"]): void {
  const authJson = process.env.CODEX_AUTH_JSON;
  if (!authJson) {
    // In production (Sprite VM), CODEX_AUTH_JSON must always be provided.
    // For local dev, set VM_AGENT_LOCAL=1 to fall back to the user's existing
    // ~/.codex/auth.json set up by the Codex CLI.
    if (process.env.VM_AGENT_LOCAL === "1") {
      emit({ type: "debug", message: "VM_AGENT_LOCAL=1 — using existing ~/.codex/auth.json" });
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

    const codexPath = resolveCodexPath(emit);

    const modelId = settings.model;
    let agentSessionId: string | undefined = args.sessionId;

    const provider = createCodexAppServer({
      defaultSettings: {
        minCodexVersion: process.env.CODEX_MIN_VERSION?.trim() || DEFAULT_CODEX_MIN_VERSION,
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
      if (!sid || sid === agentSessionId) { return; }
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
          effort: getCodexEffort(options.effort),
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

const getCodexEffort = (effort: string | undefined) => {
  if (!effort) { return undefined; }

  const parsedEffort = OpenAICodexEffort.safeParse(effort);
  if (!parsedEffort.success) {
    throw new Error(`Invalid Codex effort: ${effort}`);
  }

  return parsedEffort.data;
};
