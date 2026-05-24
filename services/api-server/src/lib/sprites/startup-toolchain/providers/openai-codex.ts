import type { Logger } from "@repo/shared";
import type {
  StartupToolchainCheck,
  StartupToolchainCheckInput,
} from "../types";
import {
  execResultErrorFields,
  failure,
  startupToolchainError,
  success,
  truncateCommandOutput,
} from "../common";

const CODEX_CHECK_ID = "openai-codex.cli";
const MIN_CODEX_CLI_VERSION = "0.130.0";
const CODEX_INSTALL_SCRIPT_URL = "https://chatgpt.com/codex/install.sh";
const CODEX_SCRIPT_VERSION = "2";

const CODEX_STARTUP_SCRIPT = `
set -euo pipefail

min_version="${MIN_CODEX_CLI_VERSION}"
install_url="${CODEX_INSTALL_SCRIPT_URL}"
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"

read_codex_version() {
  if ! command -v codex >/dev/null 2>&1; then
    return 1
  fi
  codex --version 2>&1 | grep -Eo '[0-9]+\\.[0-9]+\\.[0-9]+' | head -n 1
}

version_at_least() {
  local version="$1"
  local minimum="$2"
  local v_major v_minor v_patch m_major m_minor m_patch
  IFS=. read -r v_major v_minor v_patch <<< "$version"
  IFS=. read -r m_major m_minor m_patch <<< "$minimum"

  if (( v_major != m_major )); then
    (( v_major > m_major ))
    return
  fi
  if (( v_minor != m_minor )); then
    (( v_minor > m_minor ))
    return
  fi
  (( v_patch >= m_patch ))
}

current_version="$(read_codex_version || true)"
if [[ -n "$current_version" ]] && version_at_least "$current_version" "$min_version"; then
  echo "codex is current: $current_version"
  exit 0
fi

if [[ -n "$current_version" ]]; then
  echo "codex is stale: $current_version < $min_version"
else
  echo "codex is missing"
fi

curl -fsSL "$install_url" | sh
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"

new_version="$(read_codex_version || true)"
if [[ -z "$new_version" ]]; then
  echo "codex install did not produce a readable codex --version" >&2
  exit 1
fi

if ! version_at_least "$new_version" "$min_version"; then
  echo "codex version $new_version is below required $min_version after install" >&2
  exit 1
fi

echo "codex is ready: $new_version"
`.trim();

const CODEX_CONTRACT = {
  provider: "openai-codex",
  id: CODEX_CHECK_ID,
  minimumVersion: MIN_CODEX_CLI_VERSION,
  installScriptUrl: CODEX_INSTALL_SCRIPT_URL,
  scriptVersion: CODEX_SCRIPT_VERSION,
  script: CODEX_STARTUP_SCRIPT,
} satisfies Record<string, unknown>;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

class CodexCliCheck implements StartupToolchainCheck {
  readonly id = CODEX_CHECK_ID;
  readonly contract = CODEX_CONTRACT;
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.scope("openai-codex-startup-toolchain");
  }

  async ensureReady(
    input: StartupToolchainCheckInput,
  ) {
    const result = await input.sprite.execHttp(
      `bash -lc ${shellQuote(CODEX_STARTUP_SCRIPT)}`,
    );
    if (result.exitCode !== 0) {
      this.logger.warn("Startup toolchain check failed", {
        fields: {
          provider: "openai-codex",
          checkId: CODEX_CHECK_ID,
          requiredVersion: MIN_CODEX_CLI_VERSION,
          stdout: truncateCommandOutput(result.stdout) ?? null,
          stderr: truncateCommandOutput(result.stderr) ?? null,
          exitCode: result.exitCode,
        },
      });
      return failure(startupToolchainError(
        CODEX_CHECK_ID,
        "Codex CLI startup script failed.",
        {
          provider: "openai-codex",
          requiredVersion: MIN_CODEX_CLI_VERSION,
          ...execResultErrorFields(result),
        },
      ));
    }

    this.logger.info("Startup toolchain check completed", {
      fields: {
        provider: "openai-codex",
        checkId: CODEX_CHECK_ID,
        requiredVersion: MIN_CODEX_CLI_VERSION,
        status: "ready",
      },
    });

    return success({
      id: CODEX_CHECK_ID,
      status: "ready" as const,
      requiredVersion: MIN_CODEX_CLI_VERSION,
    });
  }
}

export function getOpenAICodexStartupToolchainChecks(
  logger: Logger,
): StartupToolchainCheck[] {
  return [new CodexCliCheck(logger)];
}

export const OPENAI_CODEX_INSTALL_SCRIPT_URL = CODEX_INSTALL_SCRIPT_URL;
export const OPENAI_CODEX_STARTUP_CHECK_ID = CODEX_CHECK_ID;
