import type { ProviderId } from "../types/providers";
import { claudeToolNormalizer } from "./providers/claude";
import { codexToolNormalizer } from "./providers/codex";
import type { NormalizableToolUIPart, NormalizedToolAction, ToolPartNormalizer } from "./types";

export * from "./types";
export { fallbackOtherAction } from "./fallback";

/**
 * Get the tool normalizer for a given provider. Mirrors the exhaustive-switch
 * pattern from `provider-credential-adapter.ts` so adding a new ProviderId
 * without a corresponding case is a compile-time error.
 */
export function getToolNormalizer(providerId: ProviderId): ToolPartNormalizer {
  switch (providerId) {
    case "claude-code":
      return claudeToolNormalizer;
    case "openai-codex":
      return codexToolNormalizer;
    default: {
      const exhaustiveCheck: never = providerId;
      throw new Error(`Unhandled provider: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Normalize a single tool part using the given provider's normalizer.
 * Pure and stateless; safe to call on every render.
 */
export function normalizeToolPart(
  part: NormalizableToolUIPart,
  providerId: ProviderId,
): NormalizedToolAction[] {
  return getToolNormalizer(providerId).normalize(part);
}
