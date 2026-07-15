# Architecture

CloudeCode is the SwiftUI iOS client for cloude-code. It talks to the API server (`services/api-server`) over HTTP and WebSocket, using API types generated from the Zod schemas in `packages/api-contract`.

The app is split into an app target (UI, features, DI wiring) and local Swift packages under `Modules/` that provide compile-time isolation for networking, domain types, and persistence. Dependencies are wired with Needle and flow through child components per feature.

## Layout

```text
CloudeCode
├── App/ # app entry point, delegate, and root view
├── Core/ # core app functionality (lifecycle, DI, styling)
└── Features/ # self-contained features (eg home, chat, settings)
├── Modules/ # local swift packages for isolated shared functionality (eg api, caching)
└── Config/ # per-environment xcconfig files
```


Local Swift packages, from lowest layer to highest:

- **Domain** (`Modules/Domain/`) - Pure, stateless, `Sendable` domain structs. Zero dependencies. This is the vocabulary the rest of the app speaks.
- **CoreAPI** (`Modules/CoreAPI/`) - Generated API wire types. `Sources/CoreAPI/Generated/` is transpiled from the Zod schemas in `packages/api-contract` by `packages/api-contract/codegen`; never edit generated files by hand. To change a type: edit the schema in `packages/api-contract/src/`, run `pnpm --filter @repo/api-contract codegen`, and commit both. `Sources/CoreAPI/Support/` (`JSONValue`, `ISODateTime`) is hand-written. Full guide: `docs/api-type-codegen.md` (repo root).
- **API** (`Modules/API/`) - Transport layer: `APIClient`, `APIRequest`, auth token plumbing, and per-surface APIs. Depends on CoreAPI and Domain. Maps CoreAPI wire types to Domain types at the boundary; wire types do not escape this package.
- **Entities** (`Modules/Entities/`) - Observable state and persistence. `@MainActor` observable model classes (reference identity, `update(from:)` merge) plus the generic identity-mapped `EntityStore<Model>`. `Persistence/` holds `Entity`-conforming SwiftData `@Model` rows (versioned schema + migration plan in `ModelContainerFactory`) confined to `Cache`'s background model actor, whose public API speaks Domain structs. Depends on Domain only.

App target (`CloudeCode/`):

- `App/` - entry point, `AppDelegate`, root view.
- `Core/DI/` - Needle root and application components. Shared dependencies are exposed from `ApplicationComponent`; features get dependencies through child components.
- `Core/Logging/` - app logging wrapper and destinations.
- `Core/Styling/` - styling tokens: `Theme` (semantic colors) and `Style` (layout, animation, fonts), injected via SwiftUI environment.
- `Features/<Feature>/` - folder-based SwiftUI features, each with its own Needle component (e.g. `Features/Home/`).
- `Generated/` - Needle generated output. Do not hand-edit unless updating the scaffold before generator wiring exists.

`Config/` holds per-environment xcconfig files consumed by the `CloudeCode` (prod) and `CloudeCode Dev` (localhost API) schemes; values flow through `Info.plist` and are read from `Bundle.main` at runtime.

Isolated utility modules should be placed in a local swift package, if possible. Isolated packages are better for compile-time performance in Xcode.

## Dependency Graph

```
Domain          (no dependencies)
CoreAPI         (no dependencies; generated from packages/api-contract)
API             → CoreAPI, Domain, SwiftAISDK
Entities        → Domain
CloudeCode app  → API, Domain, Entities (+ Needle)
```

Lower layers never import higher ones. Entities does not know about the network; API does not know about persistence or UI.

## Architectural Invariants

- Sendable Domain structs are the only data that crosses actor boundaries (network, disk, sockets).
- Observable model classes are `@MainActor` and are created/merged only inside stores — never `@unchecked Sendable`.
- CoreAPI wire types are mapped to Domain types inside `Modules/API` and do not escape it.
- Generated code (`Modules/CoreAPI/Sources/CoreAPI/Generated/`, `CloudeCode/Generated/`) is never edited by hand; change the source schema or generator instead.
- App source folders are real filesystem folders, not Xcode-only groups. No `xcuserdata/` files in version control.

## Boundaries

- **App to API server** - All server communication goes through `Modules/API`. Protocol shapes come from CoreAPI, which is generated from the same Zod schemas the server validates against, so client and server cannot drift silently.
- **Features to dependencies** - Features receive dependencies through Needle child components, not by reaching into globals or constructing shared services themselves.

## Conventions

- Reusable API, caching, persistence, and shared logic go in local Swift packages under `Modules/` and are linked to the xcode project via SPM.
- User-facing screens go in app-target features under `CloudeCode/Features/`.
- New modules target iOS 17 / macOS 14, Swift tools 6.0, and should keep dependencies minimal (Domain stays at zero).

## Tech Stack

- **SwiftUI** with the Observation framework for UI.
- **Needle** for compile-safe dependency injection. [https://needle-di.io/](https://needle-di.io/)
- **SwiftData** for on-disk persistence (versioned schema with migration plan).
- **swift-ai-sdk** for AI SDK message types in the API layer ([https://github.com/teunlao/swift-ai-sdk](https://github.com/teunlao/swift-ai-sdk))
- **Local SwiftPM packages** for module boundaries; **xcconfig** files for per-environment build settings.

