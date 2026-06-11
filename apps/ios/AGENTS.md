# CloudeCode (iOS app)

SwiftUI iOS client for Cloude Code, using Needle for DI and local Swift packages for compile-time isolation. Bundle ID: `llc.bze.CloudeCode`.

Before module, layering, package-boundary, DI, or persistence changes, read `ARCHITECTURE.md` (in this directory) — it covers package organization, the dependency graph, and layering invariants.

## Commands

```sh
swiftlint lint --strict --no-cache
xcodebuild -project CloudeCode.xcodeproj -scheme CloudeCode -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath .build/DerivedData CODE_SIGNING_ALLOWED=NO build
```

SwiftLint runs in the app target build phase for Debug builds.

See `docs/` for specific documentation about certain parts of the codebase.

`docs/Styling.md` - the iOS styling conventions.
`docs/caching.md` - how to handle caching
`docs/dependency-injection.md` - how to handle dependency injection
`docs/feature-development.md` - how to develop a new feature