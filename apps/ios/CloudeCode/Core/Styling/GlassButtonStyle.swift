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

/// Full-width capsule primary button: tinted Liquid Glass on iOS 26+, a
/// bouncy solid-tint button below (the interactive glass supplies its own
/// press feedback, so the bounce only applies to the fallback).
struct GlassButtonStyle: ButtonStyle {
    var tint: Color
    var isLoading = false

    func makeBody(configuration: Configuration) -> some View {
        GlassButtonStyleBody(configuration: configuration, tint: tint, isLoading: isLoading)
    }
}

private struct GlassButtonStyleBody: View {
    @Environment(\.style) private var style
    @Environment(\.isEnabled) private var isEnabled

    let configuration: ButtonStyleConfiguration
    let tint: Color
    let isLoading: Bool

    private var isLegacyOS: Bool {
        if #available(iOS 26.0, *) { return false }
        return true
    }

    var body: some View {
        ZStack {
            if isLoading {
                ProgressView()
                    .tint(.white)
            } else {
                configuration.label
                    .font(style.headlineFont)
                    .foregroundStyle(.white)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: style.mainButtonHeight)
        .contentShape(Capsule())
        .glassBackground(in: Capsule(), tint: tint)
        .opacity(isEnabled ? 1 : 0.5)
        .scaleEffect(isLegacyOS && configuration.isPressed ? 0.95 : 1)
        .animation(.spring(response: 0.3, dampingFraction: 0.5), value: configuration.isPressed)
    }
}
