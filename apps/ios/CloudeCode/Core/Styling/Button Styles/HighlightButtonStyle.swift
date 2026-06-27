import SwiftUI

struct HighlightButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme

    private let highlightShape = RoundedRectangle(cornerRadius: 6, style: .continuous)

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brightness(configuration.isPressed ? 0.1 : 0)
            .background {
                highlightShape
                    .fill(configuration.isPressed ? theme.tertiaryBackgroundColor : .clear)
            }
            .contentShape(highlightShape)
            .animation(.easeInOut(duration: 0.2), value: configuration.isPressed)
    }
}

struct BounceHighlightButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme

    var pressedOpacity: CGFloat = 1
    var minimumScale: CGFloat = 0.95
    var highlightColor: Color?
    var scaleBackground = true

    private let highlightShape = RoundedRectangle(cornerRadius: 6, style: .continuous)
    private var color: Color {
        highlightColor ?? theme.tertiaryBackgroundColor
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? pressedOpacity : 1)
            .background {
                highlightBackground(
                    isPressed: configuration.isPressed,
                    when: scaleBackground
                )
            }
            .contentShape(highlightShape)
            .scaleEffect(configuration.isPressed ? minimumScale : 1)
            .background {
                highlightBackground(
                    isPressed: configuration.isPressed,
                    when: !scaleBackground
                )
            }
            .animation(.easeInOut(duration: 0.2), value: configuration.isPressed)
            .animation(
                configuration.isPressed ? .spring(
                    response: 0.2,
                    dampingFraction: 0.9
                ) : .easeOut(duration: 0.2),
                value: configuration.isPressed
            )
    }

    @ViewBuilder
    private func highlightBackground(isPressed: Bool, when shouldDraw: Bool) -> some View {
        if shouldDraw {
            highlightShape
                .fill(isPressed ? color : .clear)
        }
    }
}

struct BounceButtonStyle: ButtonStyle {
    var minimumScale: CGFloat = 0.95

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? minimumScale : 1)
            .animation(.easeInOut(duration: 0.2), value: configuration.isPressed)
            .animation(
                configuration.isPressed ? .spring(
                    response: 0.2,
                    dampingFraction: 0.9
                ) : .easeOut(duration: 0.2),
                value: configuration.isPressed
            )
    }
}

extension ButtonStyle where Self == HighlightButtonStyle {
    static var highlight: Self {
        HighlightButtonStyle()
    }
}

extension ButtonStyle where Self == BounceHighlightButtonStyle {
    static var bounceHighlight: Self {
        BounceHighlightButtonStyle()
    }
}

extension ButtonStyle where Self == BounceButtonStyle {
    static var bounce: Self {
        BounceButtonStyle()
    }

    static func bounce(_ minimumScale: CGFloat) -> Self {
        BounceButtonStyle(minimumScale: minimumScale)
    }
}
