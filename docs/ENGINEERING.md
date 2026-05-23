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
- Import boundaries are enforced by `scripts/check-import-boundaries.ts`, which is run by `pnpm lint`.
- When adding or moving modules, update the boundary table with a clear layer/rationale instead of bypassing the rule with deep relative imports.

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
