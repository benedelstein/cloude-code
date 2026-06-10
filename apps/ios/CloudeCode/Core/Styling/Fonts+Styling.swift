import SwiftUI

struct FontStyleModifier: ViewModifier {
    @Environment(\.style) var style: Style

    var fontStyle: Style.FontStyle

    func body(content: Content) -> some View {
        content
            .font(style.font(fontStyle))
    }
}

extension View {
    func styledFont(_ style: Style.FontStyle) -> some View {
        modifier(FontStyleModifier(fontStyle: style))
    }
}
