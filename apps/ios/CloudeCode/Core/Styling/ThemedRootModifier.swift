import SwiftUI

/// Applies the user's appearance preference at the app root and injects the
/// matching `Theme` into the environment.
///
/// Split into two layers because `.preferredColorScheme` sets the scheme for
/// *descendants*, while the active `Theme` must be chosen by a descendant that
/// *reads* the resolved `\.colorScheme`.
struct ThemedRootModifier: ViewModifier {
    @AppStorage(AppStorageKey.themePreference) private var preferenceRaw = ThemePreference.system.rawValue

    private var preference: ThemePreference {
        ThemePreference(rawValue: preferenceRaw) ?? .system
    }

    func body(content: Content) -> some View {
        content
            .modifier(ThemeInjector())
            .preferredColorScheme(preference.colorScheme)
    }
}

/// Reads the resolved color scheme (after the preference is applied) and injects
/// the corresponding `Theme`.
private struct ThemeInjector: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content.environment(\.theme, .resolve(for: colorScheme))
    }
}

extension View {
    /// Wires up appearance preference handling and theme injection. Apply once at the app root.
    func themedRoot() -> some View {
        modifier(ThemedRootModifier())
    }
}
