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
            ChunkedTextView(chunks: [.init(id: 1, text: item.text)])
            Text(verbatim: item.text)
        case .chunkedText(let item):
            ChunkedTextView(chunks: item.chunks)
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

private struct ChunkedTextView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style: Style

    let chunks: [ChunkedTextChunk]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(chunks) { chunk in
                // future optimization use an animation to fade in each char
                // one by one instead of trusting chunk.text accumulation batches
                Text(verbatim: chunk.text)
                    // NOTE - the animation is causing render glitches so leaivng it out for now.
                    // .animation(chunkTextFadeAnimation, value: chunk.text)
                    .font(style.responseTextFont)
                    .foregroundStyle(theme.labelColor)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(style.fadeTransition)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .transition(style.fadeTransition)
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
