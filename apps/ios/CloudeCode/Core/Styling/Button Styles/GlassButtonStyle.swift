import SwiftUI

extension View {
    /// Liquid Glass background on iOS 26+, falling back to material or a solid
    /// tint with a soft shadow on older systems.
    @ViewBuilder
    func glassBackground<S: Shape>(in shape: S, tint: Color? = nil) -> some View {
        if #available(iOS 26.0, *) {
            if let tint {
                glassEffect(.regular.tint(tint).interactive(), in: shape)
            } else {
                glassEffect(.regular.interactive(), in: shape)
            }
        } else {
            if let tint {
                background(
                    shape
                        .fill(tint)
                        .shadow(color: tint.opacity(0.35), radius: 8, x: 0, y: 4)
                )
            } else {
                background(
                    shape
                        .fill(.ultraThinMaterial)
                        .shadow(color: .black.opacity(0.2), radius: 8, x: 0, y: 4)
                )
            }
        }
    }
}

enum AppGlassButtonStyle {
    case glass
    case glassProminent
}

/// Full-width capsule button fallback for OS versions before native SwiftUI
/// glass button styles are available.
struct LegacyGlassButtonStyle: ButtonStyle {
    var variant: AppGlassButtonStyle
    var tint: Color

    func makeBody(configuration: Configuration) -> some View {
        LegacyGlassButtonStyleBody(configuration: configuration, variant: variant, tint: tint)
    }
}

private struct LegacyGlassButtonStyleBody: View {
    @Environment(\.style) private var style: Style
    @Environment(\.isEnabled) private var isEnabled: Bool

    let configuration: ButtonStyleConfiguration
    let variant: AppGlassButtonStyle
    let tint: Color

    var body: some View {
        configuration.label
            .font(style.headlineFont)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: style.mainButtonHeight)
            .contentShape(Capsule())
            .background(
                Capsule()
                    .fill(backgroundFill)
                    .shadow(color: shadowColor, radius: 8, x: 0, y: 4)
            )
            .opacity(isEnabled ? 1 : 0.5)
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.5), value: configuration.isPressed)
    }

    private var backgroundFill: AnyShapeStyle {
        switch variant {
        case .glass:
            AnyShapeStyle(.ultraThinMaterial)
        case .glassProminent:
            AnyShapeStyle(tint)
        }
    }

    private var shadowColor: Color {
        switch variant {
        case .glass:
            .black.opacity(0.2)
        case .glassProminent:
            tint.opacity(0.35)
        }
    }
}

extension View {
    @ViewBuilder
    func glassButtonStyle(_ style: AppGlassButtonStyle = .glass, tint: Color) -> some View {
        if #available(iOS 26.0, *) {
            switch style {
            case .glass:
                self
                    .buttonStyle(.glass)
                    .tint(tint)
            case .glassProminent:
                self
                    .buttonStyle(.glassProminent)
                    .tint(tint)
            }
        } else {
            self.buttonStyle(LegacyGlassButtonStyle(variant: style, tint: tint))
        }
    }
}
