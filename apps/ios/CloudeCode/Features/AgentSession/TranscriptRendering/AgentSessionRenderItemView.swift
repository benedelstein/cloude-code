import Domain
import SwiftUI

struct AgentSessionRenderItemView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let item: AgentSessionRenderItem
    let isActive: Bool
    let isStreaming: Bool
    let openDetails: () -> Void

    init(
        item: AgentSessionRenderItem,
        isActive: Bool = false,
        isStreaming: Bool = false,
        openDetails: @escaping () -> Void
    ) {
        self.item = item
        self.isActive = isActive
        self.isStreaming = isStreaming
        self.openDetails = openDetails
    }

    var body: some View {
        switch item {
        case .text(let item):
            Text(verbatim: item.text)
                .font(style.responseTextFont)
                .foregroundStyle(theme.labelColor)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .chunkedText(let item):
            MarkdownTextPartsView(parts: item.parts)
        case .reasoning(let item):
            VStack(alignment: .leading, spacing: style.gridSize / 2) {
                Label("Thinking", systemImage: "brain")
                    .styledFont(.caption)
                    .foregroundStyle(theme.secondaryLabelColor)
                Text(verbatim: item.part.text)
                    .styledFont(.footnote)
                    .foregroundStyle(theme.secondaryLabelColor)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .actionItem(let item):
            Button(action: openDetails) {
                ToolActionInlineRow(item: item, isActive: isActive)
            }
            .buttonStyle(.bounce(0.97))
        }
    }
}

private struct MarkdownTextPartsView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style: Style

    let parts: [MarkdownTextPart]

    /// Parts with visible content; blank rich-text parts only carry paragraph
    /// separators, which the stack spacing already provides.
    private var visibleParts: [MarkdownTextPart] {
        parts.filter { part in
            guard case .richText(let part) = part else {
                return true
            }
            return !part.attributedText.characters.isEmpty
        }
    }

    var body: some View {
        // Zero spacing: rich text parts keep their own newlines (minus the one
        // boundary linefeed), so stacked parts reproduce the raw text's heights.
        // NOTE: - do not apply animations or content transitions here, it glitches out.
        VStack(alignment: .leading, spacing: 0) {
            ForEach(visibleParts) { part in
                switch part {
                case .richText(let part):
                    Text(part.attributedText)
                        .font(style.responseTextFont)
                        .foregroundStyle(theme.labelColor)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .transition(style.fadeTransition)
                case .codeBlock(let part):
                    TranscriptCodeBlockView(part: part)
                        .transition(style.fadeTransition)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .transition(style.fadeTransition)
    }
}

private struct TranscriptCodeBlockView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let part: MarkdownCodeBlockPart

    var body: some View {
        CodePreviewChrome(
            text: part.text,
            copyAccessibilityLabel: "Copy code",
            background: .secondary,
            title: part.language
        ) {
            codeContent
        }
        .accessibilityValue(part.isComplete ? "Complete" : "Streaming")
    }

    private var codeContent: some View {
        ScrollView(.horizontal) {
            Text(verbatim: part.text.isEmpty ? " " : part.text)
                .fixedSize(horizontal: true, vertical: true)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(theme.labelColor)
                .textSelection(.enabled)
                .padding(.top, style.gridSize)
                .padding(.bottom, style.gridSize)
                .padding(.leading, style.gridSize)
                .padding(.trailing, style.gridSize * 5)
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ToolActionInlineRow: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let item: AgentSessionRenderItem.ActionItem
    let isActive: Bool

    var body: some View {
        let title = item.title(isActive: isActive)

        HStack(spacing: style.gridSize) {
            Image(systemName: item.iconName)
                .font(style.caption2Font)
                .foregroundStyle(theme.accentBlue)
                .frame(width: 15)

            HStack(spacing: 2) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .styledFont(.footnote)
                        .foregroundStyle(theme.secondaryLabelColor)
                        .lineLimit(1)
                }

                Image(systemName: "chevron.right")
                    .font(.body(9))
                    .foregroundStyle(theme.tertiaryLabelColor)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().foregroundStyle(theme.tertiaryBackgroundColor))
        .animation(style.fadeAnimation, value: title)
        .transition(style.fadeTransition)
    }
}
