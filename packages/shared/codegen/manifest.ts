import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ManifestEntry } from "./ir";
import * as providers from "../src/types/providers/index";
import * as session from "../src/types/session";
import * as sessionsApi from "../src/types/api/sessions";
import * as clientState from "../src/types/api/client-state";
import * as websocketApi from "../src/types/api/websocket-api";
import * as userSessionsWebsocketApi from "../src/types/api/user-sessions-websocket-api";
import * as authApi from "../src/types/api/auth";
import * as reposApi from "../src/types/api/repos";
import * as modelsApi from "../src/types/api/models";
import * as attachments from "../src/types/api/attachments";
import * as repoEnvironmentsApi from "../src/types/api/repo-environments";
import * as voiceApi from "../src/types/api/voice";
import * as integrationsApi from "../src/types/api/integrations";

/**
 * Schema selection works like protobuf: pointing the generator at a source
 * module includes EVERY exported Zod schema in it — adding a schema to an
 * included module ships it to Swift with no registration step. Only
 * exceptions are listed here (see EXCLUDE / OVERRIDES below).
 *
 * `src/types/api/` is the client-contract directory: every file in it must be
 * registered here (enforced below — a new file fails codegen until listed).
 * `session.ts` and `providers/` stay explicitly listed because they mix
 * contract schemas with server-side code.
 *
 * Aliases dedup by object identity: a schema re-exported under a second name
 * (e.g. `AgentProvider = ProviderId`) generates once, under the name in the
 * earliest-listed module. Order modules accordingly.
 *
 * Enums and unions are decode-tolerant by default (`.unknown` case for values
 * this app build doesn't know). Mark `frozen` only for client→server-only
 * types. See docs/api-type-codegen.md.
 */
const SOURCES: { module: Record<string, unknown>; group: string; file?: string }[] = [
  { module: providers, group: "Providers" },
  { module: session, group: "Session" },
  { module: sessionsApi, group: "SessionsAPI", file: "sessions.ts" },
  { module: clientState, group: "ClientState", file: "client-state.ts" },
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

/** Every file in the contract directory must be a registered source. */
function assertApiDirectoryCovered(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const apiDir = path.resolve(here, "../src/types/api");
  const registered = new Set(SOURCES.flatMap((source) => (source.file ? [source.file] : [])));
  const onDisk = readdirSync(apiDir).filter(
    (name) => name.endsWith(".ts") && name !== "index.ts",
  );
  const missing = onDisk.filter((name) => !registered.has(name));
  if (missing.length > 0) {
    throw new Error(
      `src/types/api/ files missing from codegen SOURCES: ${missing.join(", ")}. ` +
        "Every file in the contract directory must be registered in codegen/manifest.ts.",
    );
  }
}

/** Exported schemas that are not an iOS surface. */
const EXCLUDE = new Set<string>([
  // Server-internal snapshot persisted in the session DO.
  "SessionEnvironmentSnapshot",
  // Bot→server session creation (Discord/Slack), authenticated with bot
  // tokens; also uses a boolean discriminator the emitter rejects.
  "IntegrationExternalUser",
  "DiscordExternalUser",
  "SlackExternalUser",
  "GenericExternalUser",
  "IntegrationSessionRequest",
  "IntegrationSessionResponse",
  "IntegrationSessionSuccessResponse",
  "IntegrationSessionErrorResponse",
  "IntegrationRepoCandidate",
]);

/** Per-type exceptions, keyed by export name. */
const OVERRIDES: Record<string, Partial<Omit<ManifestEntry, "schema" | "group">>> = {
  UIMessageSchema: {
    swiftName: "UIMessage",
    doc: "Wire shape of an AI SDK UIMessage; parts stay opaque JSON.",
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
  assertApiDirectoryCovered();
  const entries: ManifestEntry[] = [];
  const seenSchemas = new Set<unknown>();
  const seenExports = new Set<string>();

  for (const source of SOURCES) {
    // Module namespace keys are spec-ordered (alphabetical), so output is
    // deterministic regardless of declaration order.
    for (const [exportName, value] of Object.entries(source.module)) {
      if (!isZodSchema(value) || EXCLUDE.has(exportName)) {
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

  // Typo guard: every exception must reference a real export.
  const allExports = new Set(SOURCES.flatMap((source) => Object.keys(source.module)));
  for (const name of Object.keys(OVERRIDES)) {
    if (!seenExports.has(name)) {
      throw new Error(`OVERRIDES references unknown export: ${name}`);
    }
  }
  for (const name of EXCLUDE) {
    if (!allExports.has(name)) {
      throw new Error(`EXCLUDE references unknown export: ${name}`);
    }
  }

  return entries;
}

export const MANIFEST: ManifestEntry[] = buildManifest();
