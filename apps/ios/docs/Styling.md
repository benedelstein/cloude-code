# iOS Styling

App styling code is located in `CloudeCode/Core/Styling/`.

## Theme

The theme is a struct that contains the semantic color tokens. The app currently has two themes, `light` and `dark`.

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

If your feature has specific style tokens, you can create a new scoped style struct in the same manner as the global style struct.

```swift
struct SessionStyle: Style {
    let insertAnimation: Animation = .spring(duration: 0.3)
}
```

Prefer this to defining random inline variables in your view, unless they are specific to one view.
If you find yourself repeating constants in multiple views, you should create a style struct.