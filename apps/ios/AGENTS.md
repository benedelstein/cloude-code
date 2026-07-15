# CloudeCode (iOS app)

SwiftUI iOS client for Cloude Code, using Needle for DI and local Swift packages for compile-time isolation. Bundle ID: `llc.bze.CloudeCode`.

Before module, layering, package-boundary, DI, or persistence changes, you must read `ARCHITECTURE.md` (in this directory) — it covers package organization, the dependency graph, and layering invariants.

## Commands

```sh
swiftlint lint --strict --no-cache
xcodebuild -project CloudeCode.xcodeproj -scheme CloudeCode -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath .build/DerivedData CODE_SIGNING_ALLOWED=NO build
```

SwiftLint runs in the app target build phase for Debug builds.

## Documentation

Be sure to read `docs/` for specific documentation about certain parts of the codebase.

`docs/Styling.md` - iOS styling conventions. Follow styleguides and do not invent new conventions.
`docs/api.md` - networking: adding endpoints, returning domain structs
`docs/caching.md` - how to handle caching
`docs/dependency-injection.md` - how to handle dependency injection
`docs/feature-development.md` - how to develop a new feature

Read specific documentation for any part of the codebase you plan to work on, or pattern you plan to use.

## Important Agent Guidelines

- Add doc comments to **all** public methods and class definitions. Add concise inline comments where needed, to explain complex logic
or important considerations.
- prefer nested subview names over long prefixes. E.g. 
    ```swift
    extension AgentSessionView {
        struct SomeSubview: View {
            ...
        }
    }
    // NOT
    struct AgentSessionViewSomeSubview: View {
        ...
    }
    ```
    This prevents long class names and keeps features encapsulated.
