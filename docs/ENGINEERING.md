# Engineering

This document is the source of truth for repo-wide coding style and engineering conventions.

## Validation

- Use `pnpm` for all package-manager commands. If `pnpm` is not available on `PATH`, use `corepack pnpm`.
- After making changes, run the relevant package tests plus the repo-level checks:
  - `pnpm build`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
- For visual changes, use a local browser tool to validate the affected UI and capture a screenshot when useful.
- Use concise git commit messages.
- Do not use emojis in git messages or code comments.

## Dependencies

- If adding a dependency to multiple packages, prefer the shared catalog in `pnpm-workspace.yaml`.
- Put types used by multiple packages in `packages/shared` instead of duplicating interfaces.

## Linting

`pnpm lint` runs package ESLint checks through Turbo and then runs `pnpm lint:boundaries`.

The repo-wide ESLint config enforces:

- Double-quoted strings.
- Braced control-flow bodies.
- Strict equality.
- Spaced single-line blocks.
- Explicit type-only imports.
- No type-only imports that leave runtime side-effect imports behind.
- No `any`.
- No unused variables except intentionally `_`-prefixed values.
- Maximum file length of 1000 lines.
- Naming conventions for symbols:
  - Variables and imports use `camelCase`, `PascalCase`, or `UPPER_CASE`.
  - Functions use `camelCase`, with `PascalCase` allowed for React components and `UPPER_CASE` allowed for Next.js route handlers like `GET`.
  - Parameters use `camelCase`, with `PascalCase` allowed when passing component references.
  - Types, interfaces, classes, and enums use `PascalCase`.
  - Object properties, object methods, and type properties are exempt so API payloads, database fields, and external protocol names can keep their source shape.

When a lint rule exposes existing drift, prefer the mechanical fix over weakening the rule. If a rule is wrong for a specific case, add a narrow local disable with a reason rather than lowering the repo-wide standard.

## Import Boundaries

Import boundaries are enforced by `scripts/check-import-boundaries.ts`, which is run by `pnpm lint`.

The checker parses every TS/TSX file, resolves imports to repo paths, classifies source and target files into layers, and rejects imports that are not listed in the layer allowlist. This catches package imports and deep relative imports, so crossing a boundary with `../../../../services/...` is still blocked.

The checker has three intentionally editable sections:

- `layers` classifies files by exact file path or directory prefix.
- `allowedImports` defines the permitted dependency graph. Use exact layer ids for production code. Namespace wildcards like `shared:*` are supported for broad surfaces such as tests.
- `exceptions` records deliberate one-off edges with a rationale.

Use this workflow when adding a rule:

1. Add or split a layer in `layers`.
2. Add the layer's allowed dependency set in `allowedImports`.
3. Run `pnpm lint:boundaries`.
4. Move shared contracts downward if the new rule exposes a real cycle or reversed dependency.
5. Add an exception only for a narrow bridge that should remain unusual.

The current boundary checker enforces architectural direction. It does not replace TypeScript's type checker and it does not prove that runtime data is safe. Type safety at scale also requires parsing untrusted data at system boundaries.

## Boundary Parsing

Parse external data at the boundary: convert unknown input into a typed internal shape immediately, then pass the parsed value inward.

Boundary inputs include HTTP requests, WebSocket messages, Durable Object RPC inputs, VM-agent webhook payloads, provider API responses, database rows, environment variables, and secrets.

Use Zod or an equivalent parser at the entry point:

```typescript
const parseResult = AgentChunksWebhookBody.safeParse(body);
if (!parseResult.success) {
  return failure({ code: "INVALID_WEBHOOK_BODY" });
}

return handleChunks(parseResult.data);
```

Do not validate loosely and keep passing `unknown`, raw JSON, or casted values through the system. Internal services should accept the parsed type, not the untrusted input.

## Error Handling

- Use `Result<T, E>` for expected business logic and operational failures. See `packages/shared/src/types/errors.ts`.
- Define `E` as a small tagged plain-object union with a stable `code` string.
- Do not use `Error` subclasses for normal control flow.
- Use `throw` only for bugs, invariant violations, and unexpected integration/runtime failures.
- Convert integration exceptions into scoped business-error `Result` values at service boundaries before they flow through the rest of the app.

## Logging

The app-wide logger is available as `Logger` in `packages/shared/src/logging/index.ts`.

- Scope loggers to the module they are in.
- Use string interpolation for simple messages.
- Use structured `fields` when values are useful for filtering or debugging.

```typescript
logger.info(`received chunk ${sequence}, expected ${expected}`);
logger.warn("Invalid webhook body", { fields: { sessionId, issues } });
```

## TypeScript Style

- Prefer unabbreviated variable names over shortened names. For example, prefer `installation` over `inst`.
- Variable names should still remain concise; avoid names longer than roughly 30 characters unless clarity requires it.
- Prefer `async`/`await` over callbacks and `.then()`/`.catch()`.
- Prefer `switch` statements over if/else chains when handling discrete cases.
- Make switches over discriminated unions exhaustive.

```typescript
switch (expression) {
  case "value1":
    break;
  case "value2":
    break;
  default: {
    const exhaustiveCheck: never = expression;
    throw new Error(`Unhandled value: ${exhaustiveCheck}`);
  }
}
```

## Comments

- Add doc comments to public-facing methods.
- Public method comments should describe the method, its parameters, and return value.
- Add concise inline comments only where they clarify non-obvious code.
- Do not add docstrings or comments to code that was not changed.

## Design Taste

- Prefer the simplest working solution.
- Avoid speculative features and future-proofing.
- Avoid abstractions or helpers for single-use operations.
- If multiple uses exist, DRY up the code.
- Do not create fallback error-handling logic to cover up an error that should not exist.
