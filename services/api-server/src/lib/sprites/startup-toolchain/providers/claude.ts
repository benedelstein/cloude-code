import type {
  ProviderStartupToolchainInput,
  ProviderStartupToolchain,
  ProviderStartupToolchainContract,
} from "../types";
import { success } from "../common";

const CLAUDE_CONTRACT: ProviderStartupToolchainContract = {
  provider: "claude-code",
  checks: [],
};

export class ClaudeStartupToolchain implements ProviderStartupToolchain {
  getContract(): ProviderStartupToolchainContract {
    return CLAUDE_CONTRACT;
  }

  async ensureReady({ contractHash }: ProviderStartupToolchainInput) {
    return success({
      provider: "claude-code" as const,
      contractHash,
      checkedAt: Date.now(),
      results: [{ id: "claude-code.no-checks", status: "no-checks" as const }],
    });
  }
}
