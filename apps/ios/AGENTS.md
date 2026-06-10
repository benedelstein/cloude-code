# CloudeCode (iOS app)

SwiftUI iOS client for Cloude Code, using Needle for DI and local Swift packages for compile-time isolation. Bundle ID: `llc.bze.CloudeCode`.

## Layout

- `CloudeCode/App/` - app entry point, delegate, and root view.
- `CloudeCode/Core/DI/` - Needle root and application components.
- `CloudeCode/Core/Logging/` - app logging wrapper and destinations.
- `CloudeCode/Core/Styling/` - styling tokens: `Theme` (semantic colors) and `Style` (layout, animation, and iOS-standard font sizes), both injected via SwiftUI environment (`@Environment(\.theme)`, `@Environment(\.style)`). Use `.styledFont(_:)` for text.
- `CloudeCode/Features/<Feature>/` - app-target SwiftUI features.
- `CloudeCode/Generated/` - Needle generated output. Do not hand-edit unless updating the scaffold before generator wiring exists.
- `Modules/API/` - isolated API client Swift package (transport: APIClient, APIRequest, auth).
- `Modules/CoreAPI/` - generated API types. `Sources/CoreAPI/Generated/` is transpiled from the Zod schemas in `packages/shared` by `packages/shared/codegen`; NEVER edit generated files by hand. To change a type: edit the schema in `packages/shared/src/types/`, run `pnpm --filter @repo/shared codegen`, and commit both. `Sources/CoreAPI/Support/` (JSONValue, ISO8601) is hand-written. Fixture round-trip tests: `cd Modules/CoreAPI && swift test`. Full guide: `docs/api-type-codegen.md`.
- `Modules/Cache/` - isolated caching Swift package.

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
