import SwiftUI

/// Compact tinted callout used for inline guidance and errors.
struct CalloutView<Content: View>: View {
    let tint: Color
    let systemImage: String
    private let content: Content

    init(
        tint: Color,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) {
        self.tint = tint
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        Label {
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        } icon: {
            Image(systemName: systemImage)
        }
        .font(.footnote)
        .foregroundStyle(tint)
        .padding(12)
        .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
    }
}
