import SwiftUI
import UIKit

/// Shared copyable container chrome for transcript and tool-detail code previews.
struct CodePreviewChrome<Content: View>: View {
    enum Background {
        case primary
        case secondary

        func color(in theme: Theme) -> Color {
            switch self {
            case .primary:
                theme.backgroundColor
            case .secondary:
                theme.secondaryBackgroundColor
            }
        }
    }

    @Environment(\.theme) private var theme
    @Environment(\.style) private var style
    @Environment(\.showToast) private var showToast
    @Environment(\.lightFeedback) private var lightFeedback

    private let text: String
    private let copyAccessibilityLabel: String
    private let background: Background
    private let content: Content

    /// Creates chrome with a copy affordance around caller-supplied code content.
    init(
        text: String,
        copyAccessibilityLabel: String,
        background: Background,
        @ViewBuilder content: () -> Content
    ) {
        self.text = text
        self.copyAccessibilityLabel = copyAccessibilityLabel
        self.background = background
        self.content = content()
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            content

            Button(action: copyText) {
                Image(systemName: "square.on.square")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(theme.secondaryLabelColor)
                    .padding(6)
                    .contentShape(Rectangle())
                    .background(
                        RoundedRectangle(cornerRadius: 6).fill(theme.secondaryBackgroundColor)
                    )
            }
            .accessibilityLabel(copyAccessibilityLabel)
            .padding(style.gridSize / 2)
        }
        .background(
            RoundedRectangle(cornerRadius: style.gridSize)
                .fill(background.color(in: theme))
        )
        .clipShape(RoundedRectangle(cornerRadius: style.gridSize))
    }

    private func copyText() {
        UIPasteboard.general.string = text
        lightFeedback.impactOccurred()
        showToast?(title: "Copied", icon: Image(systemName: "doc.on.doc"))
    }
}
