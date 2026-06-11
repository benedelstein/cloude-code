# iOS Styling

App styling code is located in `CloudeCode/Core/Styling/`.

## Theme

The theme is a struct that contains the semantic color tokens. The app currently has one theme, but may be expanded to support others (eg dark and light mode)

The theme is injected into the environment using the `@Environment(\.theme)` property wrapper. Views can access the theme by fetching

```swift
@Environment(\.theme) private var theme
```

Colors should mostly match the web-app colors (see `apps/web/app/globals.css`).

## Style

The style is a struct that contains the layout, animation, and font tokens. Basically anything styling-related that is not a color.

The style is injected into the environment using the `@Environment(\.style)` property wrapper. Views can access the style by fetching

```swift
@Environment(\.style) private var style
```
