# API Type Codegen (Zod → Swift)

The iOS app's API types are not written by hand. They are transpiled from the Zod schemas in `packages/api-contract/src/` — the same schemas the API server validates with and the web client imports (via `@repo/shared`, which re-exports the whole contract) — into a checked-in Swift package at `apps/ios/Modules/CoreAPI`. One source of truth; drift is a CI failure, not a runtime decode bug.

For the AI SDK UI transcript contract specifically, see
`docs/ai-sdk-ui-wire-contract.md`. It explains why this repo owns `WireUIMessage`
schemas instead of exposing AI SDK TypeScript types directly, and where those
schemas may and may not be used.

```
packages/api-contract/src/**/*.ts     (Zod schemas — source of truth)
        │
        │  pnpm --filter @repo/api-contract codegen
        ▼
packages/api-contract/codegen/        (the transpiler)
        │
        ▼
apps/ios/Modules/CoreAPI/
  Sources/CoreAPI/Generated/*.generated.swift   (Codable types — committed)
  Tests/CoreAPITests/Fixtures/*.json            (wire fixtures — committed)
  Tests/CoreAPITests/FixtureDecodingTests.generated.swift
```

## Adding or changing an API type

Selection works like protobuf: pointing the generator at a source module includes **every exported Zod schema** in it. There is no per-type registration.

**The package is the contract**: `@repo/api-contract` contains nothing but client-facing schemas, the way a protobuf definitions package contains nothing but `.proto` files. Every non-barrel `src/**/*.ts` file must be registered in `SOURCES` (codegen fails listing any file you forgot, so the rule is enforced, not remembered). `index.ts` barrel files are skipped by `listContractSourceFiles(...)` in `packages/api-contract/codegen/manifest.ts`. Server-internal types (vm-agent protocol, bot integration schemas, environment snapshots, the provider registry) live in `@repo/shared` instead — there is no exclusion list.

1. **Edit or add the schema** in `packages/api-contract/src/` as usual (Zod object/enum/discriminatedUnion with the dual `const Schema` + `type T = z.infer` export pattern). A new export in an existing file transpiles automatically under its export name — no registration.
2. **Only for exceptions**, touch `manifest.ts`:
   - New source *file* → one line in `SOURCES` (module + output group; one generated Swift file per group) plus the needed barrel export from `src/index.ts` or a nested `index.ts`; codegen reminds you with a hard error for non-`index.ts` files.
   - Type that must **not** ship to iOS → it doesn't belong in this package; define it in `@repo/shared`.
   - Swift name overrides, reserved-word `renames` (`private` → `isPrivate`), doc strings → `OVERRIDES`.
   - Enums/unions are **decode-tolerant by default** (unrecognized server values decode to `.unknown` instead of throwing). Mark `frozen: true` in `OVERRIDES` only for client→server-only unions where an unknown case is dead code (`ClientMessage`).
   - Re-export aliases dedup by object identity and generate once, under the name in the earliest-listed module.
3. **Fixtures are synthesized automatically** (`codegen/synthesize-fixtures.ts`): every struct gets `autoFull`/`autoMinimal` samples and every union gets one sample per variant, written to `Fixtures/AutoFixtures.generated.json` and parse-gated against the real Zod schema (so the synthesizer cannot inherit a generator misreading). Hand-written fixtures in `codegen/fixtures.ts` are optional — add one only for realism the synthesizer can't invent (actual AI SDK message parts, populated state).
4. **Regenerate**: `pnpm --filter @repo/api-contract codegen`, then commit the schema change *and* the regenerated Swift together.
5. **Verify**: `cd apps/ios/Modules/CoreAPI && swift test`.

Net workflow for a type in an existing contract file: edit the schema, run codegen, commit. Nothing else.

Never edit `*.generated.swift` or fixture JSON by hand — the generator owns those files and deletes orphans. Hand-written support code (`JSONValue`, `ISO8601`) lives in `Sources/CoreAPI/Support/`.

## How the transpiler works

`packages/api-contract/codegen/` has five parts:

- **`manifest.ts`** — the explicit registry of schemas to transpile, with Swift names, file groups, and per-type flags.
- **`introspect.ts`** — registers every manifest schema in a `z.registry()` under its Swift name and converts the whole registry with `z.toJSONSchema(registry, { io: "output" })`. Cross-references between registered schemas come back as `$ref`s (→ Swift type references); inline objects and enums are synthesized as nested Swift types named after their property (`SessionSummary.PullRequest`, `UIMessage.Role`). The JSON Schema is then normalized into a small IR (`ir.ts`). Unsupported shapes throw with the offending JSON attached — the generator fails loudly rather than emitting wrong Swift.
- **`emit-swift.ts`** — renders the IR as Swift source.
- **`fixtures.ts`** — wire fixtures, serialized from the *parsed* value so schema defaults are materialized (matching real server output).
- **`generate.ts`** — the harness: writes output, or with `--check` exits non-zero listing stale/orphaned files.

`io: "output"` matters: fields with `.default()` are required in server JSON, so they map to non-optional Swift properties — and the default value becomes the memberwise-init default, which preserves request-side ergonomics (`AgentSettingsClaude()` works; the encoder always sends complete JSON the server accepts).

### Type mapping

| Zod | Swift |
|---|---|
| `z.object` | `struct: Codable, Equatable, Sendable` + explicit memberwise init |
| `z.enum` | `enum: String, Codable, CaseIterable` |
| `z.enum` + `nonFrozen` | manual `RawRepresentable` enum + `.unknown(String)` |
| `z.discriminatedUnion` | enum with one case per variant + custom Codable that switches on the discriminator; `nonFrozen` adds `.unknown(type: String)` |
| `.optional()` / `.nullable()` | `T?` (encoded as omit-when-nil) |
| `z.array(T)` / `z.record(z.string(), T)` | `[T]` / `[String: T]` |
| `z.uuid()` | `String` (opaque client id; UUID validation stays server-side) |
| `z.iso.datetime()` | `ISODateTimeString` (= `String`; parse with `ISO8601.date(from:)` at the display edge) |
| `z.number()` / `.int()` / `z.boolean()` | `Double` / `Int` / `Bool` |
| `z.literal("x")` | `let field = "x"` — encoded on the wire, skipped during decode (with explicit CodingKeys to keep the build warning-free) |
| `z.unknown()` | `JSONValue` (AI SDK message parts/chunks stay opaque) |
| `.describe("…")` | `///` doc comment |
| `.refine` / `.min` / `.max` / `.trim` | dropped — validation stays server-side |

SCREAMING_SNAKE and dotted raw values become Swift-style case names (`GITHUB_AUTH_REQUIRED` → `.githubAuthRequired`, `"session.mark_read"` → `.sessionMarkRead`); the raw string is preserved for the wire.

### The sync guarantee

Three layers, all enforced in CI (`ci-ios.yml` on macOS, plus a cheap `codegen:check` on the Linux api-server workflow):

1. **Staleness**: `pnpm --filter @repo/api-contract codegen:check` fails if committed output doesn't match the schemas.
2. **Validity**: every fixture passes `schema.parse()` at generation time, so fixtures can't drift from the contract.
3. **Round-trip**: generated Swift tests decode each TS-produced fixture, re-encode, re-decode, and compare — and also compare the re-encoded JSON against the original fixture as canonicalized `JSONValue` (object-member nulls stripped), so a field the generator silently dropped cannot pass. Green means both languages agree on the wire format.

## Known limitations

- Discriminator values must be string literals (the boolean-discriminated `IntegrationSessionResponse` is bot-facing and lives in @repo/shared, outside the contract).
- No support for `z.lazy` (recursion), transforms, intersections, or non-discriminated unions — the introspector throws if one appears in manifest scope.
- AI SDK UI transcript data uses app-owned `WireUIMessage*` schemas under
  `packages/api-contract/src/ui-message/`. They mirror AI SDK JSON while giving
  Swift codegen, unknown-variant preservation, and API-boundary validation a
  stable source of truth. See `docs/ai-sdk-ui-wire-contract.md`.
- Swift clients intentionally treat `z.uuid()` fields as `String` instead of `UUID`: the server still validates UUID shape today, but clients keep identifiers opaque so future non-UUID ID formats do not require app-side type changes.
