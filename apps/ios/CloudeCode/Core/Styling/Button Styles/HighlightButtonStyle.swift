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

extension ButtonStyle where Self == HighlightButtonStyle {
    static var highlight: Self {
        HighlightButtonStyle()
    }
}
