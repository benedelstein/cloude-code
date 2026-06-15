import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ManifestEntry } from "./ir";
import * as providers from "../src/providers";
import * as session from "../src/session";
import * as sessionsApi from "../src/sessions";
import * as clientState from "../src/client-state";
import * as uiMessageCommon from "../src/ui-message/common";
import * as uiMessageParts from "../src/ui-message/parts";
import * as uiMessageChunks from "../src/ui-message/chunks";
import * as uiMessage from "../src/ui-message/message";
import * as uiMessageAISDK from "../src/ui-message/ai-sdk";
import * as uiMessageWireValidation from "../src/ui-message/wire-validation";
import * as websocketApi from "../src/websocket-api";
import * as userSessionsWebsocketApi from "../src/user-sessions-websocket-api";
import * as authApi from "../src/auth";
import * as reposApi from "../src/repos";
import * as modelsApi from "../src/models";
import * as attachments from "../src/attachments";
import * as repoEnvironmentsApi from "../src/repo-environments";
import * as voiceApi from "../src/voice";
import * as integrationsApi from "../src/integrations";

/**
 * THE PACKAGE IS THE CONTRACT: every exported Zod schema in src/ transpiles
 * to Swift, like every message in a .proto file. Adding a schema to an
 * existing file ships it with no registration step; a new src/ file needs one
 * SOURCES line (enforced below — codegen fails until it's listed). Types that
 * are not part of the client contract belong in @repo/shared, not here.
 *
 * Aliases dedup by object identity: a schema re-exported under a second name
 * (e.g. `AgentProvider = ProviderId`) generates once, under the name in the
 * earliest-listed module. Order modules accordingly.
 *
 * Enums and unions are decode-tolerant by default (`.unknown` case for values
 * this app build doesn't know). Mark `frozen` only for client→server-only
 * types. See docs/api-type-codegen.md.
 */
const SOURCES: { module: Record<string, unknown>; group: string; file: string }[] = [
  { module: providers, group: "Providers", file: "providers.ts" },
  { module: session, group: "Session", file: "session.ts" },
  { module: sessionsApi, group: "SessionsAPI", file: "sessions.ts" },
  { module: clientState, group: "ClientState", file: "client-state.ts" },
  { module: uiMessageCommon, group: "UIMessage", file: "ui-message/common.ts" },
  { module: uiMessageParts, group: "UIMessage", file: "ui-message/parts.ts" },
  { module: uiMessageChunks, group: "UIMessage", file: "ui-message/chunks.ts" },
  { module: uiMessage, group: "UIMessage", file: "ui-message/message.ts" },
  { module: uiMessageAISDK, group: "UIMessage", file: "ui-message/ai-sdk.ts" },
  { module: uiMessageWireValidation, group: "UIMessage", file: "ui-message/wire-validation.ts" },
  { module: websocketApi, group: "WebSocket", file: "websocket-api.ts" },
  {
    module: userSessionsWebsocketApi,
    group: "UserSessionsWebSocket",
    file: "user-sessions-websocket-api.ts",
  },
  { module: authApi, group: "Auth", file: "auth.ts" },
  { module: reposApi, group: "Repos", file: "repos.ts" },
  { module: modelsApi, group: "Models", file: "models.ts" },
  { module: attachments, group: "Attachments", file: "attachments.ts" },
  { module: repoEnvironmentsApi, group: "RepoEnvironments", file: "repo-environments.ts" },
  { module: voiceApi, group: "Voice", file: "voice.ts" },
  { module: integrationsApi, group: "Integrations", file: "integrations.ts" },
];

/** Every file in the package's src/ must be a registered source. */
function assertContractPackageCovered(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcDir = path.resolve(here, "../src");
  const registered = new Set(SOURCES.map((source) => source.file));
  const onDisk = listContractSourceFiles(srcDir);
  const missing = onDisk.filter((name) => !registered.has(name));
  if (missing.length > 0) {
    throw new Error(
      `src/ files missing from codegen SOURCES: ${missing.join(", ")}. ` +
        "Every file in the contract package must be registered in codegen/manifest.ts.",
    );
  }
}

function listContractSourceFiles(rootDir: string, relativeDir = ""): string[] {
  const absoluteDir = path.join(rootDir, relativeDir);
  const files: string[] = [];
  for (const name of readdirSync(absoluteDir).sort()) {
    const relativePath = relativeDir ? `${relativeDir}/${name}` : name;
    const absolutePath = path.join(rootDir, relativePath);
    if (statSync(absolutePath).isDirectory()) {
      files.push(...listContractSourceFiles(rootDir, relativePath));
      continue;
    }
    if (name.endsWith(".ts") && name !== "index.ts") {
      files.push(relativePath);
    }
  }
  return files;
}

/** Per-type exceptions, keyed by export name. */
const OVERRIDES: Record<string, Partial<Omit<ManifestEntry, "schema" | "group">>> = {
  JSONPayloadSchema: {
    swiftName: "JSONPayload",
    doc: "Arbitrary JSON payload carried by AI SDK-compatible UI wire data.",
  },
  ProviderMetadataSchema: {
    swiftName: "ProviderMetadata",
    doc: "Provider-scoped metadata map used by AI SDK-compatible UI wire data.",
  },
  ToolApprovalSchema: {
    swiftName: "ToolApproval",
    doc: "Approval metadata for AI SDK-compatible tool UI parts.",
  },
  ToolInvocationStateSchema: {
    swiftName: "ToolInvocationState",
    doc: "Broad state discriminator for AI SDK-compatible tool UI parts.",
  },
  WireUIMessagePartSchema: {
    swiftName: "WireUIMessagePart",
    doc: "Wire shape of an AI SDK-compatible UI message part.",
    openUnion: uiMessageParts.UI_MESSAGE_PART_OPEN_UNION,
  },
  WireUIMessageChunkSchema: {
    swiftName: "WireUIMessageChunk",
    doc: "Wire shape of an AI SDK-compatible UI message stream chunk.",
    openUnion: uiMessageChunks.UI_MESSAGE_CHUNK_OPEN_UNION,
  },
  WireUIMessageSchema: {
    swiftName: "WireUIMessage",
    doc: "Wire shape of an AI SDK-compatible UIMessage.",
  },
  ClientStateSchema: {
    swiftName: "ClientState",
    doc: "Session state synced to clients via the Cloudflare Agents SDK.",
  },
  ClientMessage: {
    // Client→server only: this app never decodes one, so an unknown case
    // would be dead code. Stays frozen.
    frozen: true,
    doc: "Client → server session WebSocket messages.",
  },
  ServerMessage: { doc: "Server → client session WebSocket messages." },
  UserSessionsServerMessage: {
    doc: "Server → client messages on the user-level sessions WebSocket.",
  },
  AgentSettings: { doc: "Active agent settings, discriminated by provider." },
  // Swift reserved words.
  Repo: { renames: { private: "isPrivate" } },
  Branch: { renames: { default: "isDefault" } },
};

function isZodSchema(value: unknown): value is ManifestEntry["schema"] {
  return typeof value === "object" && value !== null && "_zod" in value;
}

function buildManifest(): ManifestEntry[] {
  assertContractPackageCovered();
  const entries: ManifestEntry[] = [];
  const seenSchemas = new Set<unknown>();
  const seenExports = new Set<string>();

  for (const source of SOURCES) {
    // Module namespace keys are spec-ordered (alphabetical), so output is
    // deterministic regardless of declaration order.
    for (const [exportName, value] of Object.entries(source.module)) {
      if (!isZodSchema(value)) {
        continue;
      }
      seenExports.add(exportName);
      if (seenSchemas.has(value)) {
        continue; // re-export alias; generated under its first name
      }
      seenSchemas.add(value);
      const override = OVERRIDES[exportName];
      entries.push({
        schema: value,
        swiftName: override?.swiftName ?? exportName,
        group: source.group,
        ...override,
      });
    }
  }

  // Typo guard: every override must reference a real export.
  for (const name of Object.keys(OVERRIDES)) {
    if (!seenExports.has(name)) {
      throw new Error(`OVERRIDES references unknown export: ${name}`);
    }
  }

  return entries;
}

export const MANIFEST: ManifestEntry[] = buildManifest();
