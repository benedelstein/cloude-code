import SwiftUI

extension View {
    /// Liquid Glass background on iOS 26+, falling back to material or a solid
    /// tint with a soft shadow on older systems.
    @ViewBuilder
    func glassBackground<S: Shape>(
        in shape: S,
        tint: Color? = nil,
        interactive: Bool = true
    ) -> some View {
        if #available(iOS 26.0, *) {
            let effect: Glass = {
                var glass: Glass = .regular
                if let tint {
                    glass = glass.tint(tint)
                }
                if interactive {
                    glass = glass.interactive()
                }
                return glass
            }()
            glassEffect(effect, in: shape)
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
    var tint: Color?

    func makeBody(configuration: Configuration) -> some View {
        LegacyGlassButtonStyleBody(configuration: configuration, variant: variant, tint: tint)
    }
}

private struct LegacyGlassButtonStyleBody: View {
    @Environment(\.style) private var style: Style
    @Environment(\.isEnabled) private var isEnabled: Bool

    let configuration: ButtonStyleConfiguration
    let variant: AppGlassButtonStyle
    let tint: Color?

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
        if let tint {
            AnyShapeStyle(tint)
        } else {
            AnyShapeStyle(.ultraThinMaterial)
        }
    }

    private var shadowColor: Color {
        if let tint {
            tint.opacity(0.35)
        } else {
            .black.opacity(0.2)
        }
    }
}

extension View {
    @ViewBuilder
    func glassButtonStyle(_ style: AppGlassButtonStyle = .glass, tint: Color? = nil) -> some View {
        if #available(iOS 26.0, *) {
            switch style {
            case .glass:
                if let tint {
                    self
                        .buttonStyle(.glass)
                        .tint(tint)
                } else {
                    self.buttonStyle(.glass)
                }
            case .glassProminent:
                if let tint {
                    self
                        .buttonStyle(.glassProminent)
                        .tint(tint)
                } else {
                    self.buttonStyle(.glassProminent)
                }
            }
        } else {
            self.buttonStyle(LegacyGlassButtonStyle(variant: style, tint: tint))
        }
    }
}
