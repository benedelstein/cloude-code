import { ProviderId, type AgentMode, type AgentSettingsInput, type CreateSessionRequest } from "@repo/shared";

const slackMentionPattern = /<@[A-Z0-9]+>\s*/g;

type SlackCommandParseResult =
  | { ok: true; command: CreateSessionRequest }
  | { ok: false; message: string };

interface SlackCommandConfig {
  defaultRepoId?: number;
}

interface ParsedTokenState {
  repoId?: number;
  branch?: string;
  agentMode?: AgentMode;
  settings: AgentSettingsInput;
  messageParts: string[];
}

export function parseSlackCommand(
  text: string,
  config: SlackCommandConfig,
): SlackCommandParseResult {
  const commandText = removeSlackMentions(text).trim();
  if (!commandText) {
    return { ok: false, message: commandHelp(config.defaultRepoId) };
  }

  const state: ParsedTokenState = {
    repoId: config.defaultRepoId,
    settings: {},
    messageParts: [],
  };

  for (const token of commandText.split(/\s+/)) {
    if (consumeToken(token, state)) {
      continue;
    }
    state.messageParts.push(token);
  }

  const initialMessage = state.messageParts.join(" ").trim();
  if (!state.repoId) {
    return {
      ok: false,
      message: "I need a repo id. Try `repo:123456 fix the failing tests`.",
    };
  }
  if (!initialMessage) {
    return { ok: false, message: commandHelp(config.defaultRepoId) };
  }

  return {
    ok: true,
    command: {
      repoId: state.repoId,
      branch: state.branch,
      agentMode: state.agentMode,
      settings: hasSettings(state.settings) ? state.settings : undefined,
      initialMessage,
    },
  };
}

function removeSlackMentions(text: string): string {
  return text.replace(slackMentionPattern, "");
}

function consumeToken(token: string, state: ParsedTokenState): boolean {
  const [rawKey, ...valueParts] = token.split(":");
  if (!rawKey || valueParts.length === 0) {
    return false;
  }

  const key = rawKey.toLowerCase();
  const value = valueParts.join(":").trim();
  if (!value) {
    return false;
  }

  switch (key) {
    case "repo": {
      const repoId = Number(value);
      if (!Number.isInteger(repoId) || repoId <= 0) {
        return false;
      }
      state.repoId = repoId;
      return true;
    }
    case "branch":
      state.branch = value;
      return true;
    case "mode":
      if (value === "edit" || value === "plan") {
        state.agentMode = value;
        return true;
      }
      return false;
    case "provider": {
      const provider = ProviderId.safeParse(value);
      if (!provider.success) {
        return false;
      }
      state.settings.provider = provider.data;
      return true;
    }
    case "model":
      state.settings.model = value;
      return true;
    case "effort":
      state.settings.effort = value;
      return true;
    default:
      return false;
  }
}

function hasSettings(settings: AgentSettingsInput): boolean {
  return Boolean(settings.provider || settings.model || settings.effort || settings.maxTokens);
}

function commandHelp(defaultRepoId: number | undefined): string {
  if (defaultRepoId) {
    return "Tell me what to do, for example `fix the failing tests`. You can override the repo with `repo:123456`.";
  }
  return "Tell me what repo and task to use, for example `repo:123456 fix the failing tests`.";
}
