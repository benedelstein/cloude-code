# CloudeCode (iOS app)

SwiftUI iOS client for Cloude Code, using Needle for DI and local Swift packages for compile-time isolation. Bundle ID: `llc.bze.CloudeCode`.

Before module, layering, package-boundary, DI, or persistence changes, read `ARCHITECTURE.md` (in this directory) — it covers package organization, the dependency graph, and layering invariants.

## Layout

- `Config/` - per-environment xcconfig files. Schemes: `CloudeCode` (Debug/Release configs, prod API, `llc.bze.CloudeCode`) and `CloudeCode Dev` (Development Debug/Release configs, `http://localhost:8787`, `llc.bze.CloudeCode-Dev`). xcconfig values flow through `CloudeCode/Info.plist` (`APIBaseURL`, `BuildEnvironment`) and are read at runtime from `Bundle.main`.
- `CloudeCode/App/` - app entry point, delegate, and root view.
- `CloudeCode/Core/DI/` - Needle root and application components.
- `CloudeCode/Core/Logging/` - app logging wrapper and destinations.
- `CloudeCode/Core/Styling/` - styling tokens: `Theme` (semantic colors) and `Style` (layout, animation, and iOS-standard font sizes), both injected via SwiftUI environment (`@Environment(\.theme)`, `@Environment(\.style)`). Use `.styledFont(_:)` for text.
- `CloudeCode/Features/<Feature>/` - app-target SwiftUI features.
- `CloudeCode/Generated/` - Needle generated output. Do not hand-edit unless updating the scaffold before generator wiring exists.
- `Modules/API/` - isolated API client Swift package (transport: APIClient, APIRequest, auth).
- `Modules/CoreAPI/` - generated API types. `Sources/CoreAPI/Generated/` is transpiled from the Zod schemas in `packages/api-contract` by its `codegen/`; NEVER edit generated files by hand. To change a type: edit the schema in `packages/api-contract/src/`, run `pnpm --filter @repo/api-contract codegen`, and commit both. `Sources/CoreAPI/Support/` (JSONValue, ISO8601) is hand-written. Fixture round-trip tests: `cd Modules/CoreAPI && swift test`. Full guide: `docs/api-type-codegen.md`.
- `Modules/Domain/` - pure stateless domain structs, zero dependencies.
- `Modules/Entities/` - `@MainActor` observable model classes (reference identity, `update(from:)` merge) + generic identity-mapped `EntityStore<Model>`, plus persistence in `Persistence/`: `Entity`-conforming SwiftData `@Model` rows (with versioned schema + migration plan in `ModelContainerFactory`) confined to `Cache`'s background model actor, whose public API speaks Domain structs. Entity instances must never be used outside `Cache`. Tests: `cd Modules/Entities && swift test`.

Layering rule: Sendable Domain structs are the only data that crosses actor boundaries (network, disk, sockets). Observable model classes are `@MainActor` and are created/merged only inside stores — never `@unchecked Sendable`. CoreAPI wire types are mapped to Domain types inside `Modules/API` and do not escape it.

Use real filesystem folders. Do not convert app source folders into Xcode-only groups or add `xcuserdata/` files.

## Commands

```sh
swiftlint lint --strict --no-cache
xcodebuild -project CloudeCode.xcodeproj -scheme CloudeCode -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath .build/DerivedData CODE_SIGNING_ALLOWED=NO build
```

SwiftLint runs in the app target build phase for Debug builds.

## Conventions

- Add reusable API, caching, persistence, and shared logic as local Swift packages under `Modules/`.
- Add user-facing screens as folder-based app-target features under `CloudeCode/Features/`.
- Expose shared dependencies from `ApplicationComponent`; pass feature dependencies through child Needle components.
- Keep SwiftLint strict. Fix violations rather than weakening rules.
