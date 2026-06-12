import Entities
import SwiftUI

struct AgentSessionView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    @State private var store: AgentSessionStore
    @State private var scrollTarget: SessionScrollTarget? = .bottom
    @FocusState private var composerFocused: Bool

    init(store: AgentSessionStore) {
        _store = State(initialValue: store)
    }

    var body: some View {
        VStack(spacing: 0) {
            sessionHeader
                .padding(.horizontal, style.horizontalPadding)
                .padding(.vertical, style.gridSize)

            Divider()

            SessionTranscriptScaffold(
                messages: store.messages,
                stream: store.stream,
                scrollTarget: $scrollTarget
            )
            .onChange(of: store.transcriptRevision) { _, _ in
                scrollTarget = .bottom
            }

            Divider()

            PromptComposerView(
                text: $store.draftText,
                focused: $composerFocused,
                placeholder: store.isConnected ? "Send a message..." : "Connecting...",
                isSubmitDisabled: !store.canSubmitDraft,
                isSubmitting: store.isSending,
                onSubmit: store.submitDraft
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle("Session")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            store.bind()
        }
        .onDisappear {
            store.unbind()
        }
    }

    private var sessionHeader: some View {
        VStack(alignment: .leading, spacing: style.gridSize / 2) {
            Text(store.session.title ?? "Untitled session")
                .styledFont(.headline)
                .foregroundStyle(theme.labelColor)
                .lineLimit(1)

            HStack(spacing: style.gridSize) {
                Text(store.clientState.repoFullName ?? store.session.repoFullName)
                    .lineLimit(1)

                Text(store.clientState.status)

                if store.clientState.activeTurnUserMessageId != nil {
                    ProgressView()
                        .controlSize(.small)
                        .tint(theme.secondaryLabelColor)
                }
            }
            .styledFont(.caption)
            .foregroundStyle(theme.secondaryLabelColor)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private enum SessionScrollTarget: Hashable {
    case message(String)
    case stream
    case bottom
}

private struct SessionTranscriptScaffold: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let messages: [AgentSessionMessage]
    let stream: AgentSessionStreamState
    @Binding var scrollTarget: SessionScrollTarget?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: style.spacing) {
                if messages.isEmpty, !stream.isActive {
                    ContentUnavailableView(
                        "No messages yet",
                        systemImage: "text.bubble"
                    )
                    .frame(maxWidth: .infinity, minHeight: style.gridSize * 30)
                } else {
                    ForEach(messages) { message in
                        MessageScaffoldRow(message: message)
                            .id(SessionScrollTarget.message(message.id))
                    }

                    if stream.isActive {
                        StreamingMessageScaffold(chunkCount: stream.chunkCount)
                            .id(SessionScrollTarget.stream)
                    }
                }

                Color.clear
                    .frame(height: 1)
                    .id(SessionScrollTarget.bottom)
            }
            .scrollTargetLayout()
            .padding(style.horizontalPadding)
        }
        .defaultScrollAnchor(.bottom)
        .scrollPosition(id: $scrollTarget, anchor: .bottom)
        .scrollDismissesKeyboard(.interactively)
        .background(theme.backgroundColor)
    }
}

private struct MessageScaffoldRow: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let message: AgentSessionMessage

    var body: some View {
        VStack(alignment: .leading, spacing: style.gridSize / 2) {
            Text(message.roleLabel)
                .styledFont(.caption)
                .foregroundStyle(theme.secondaryLabelColor)

            RoundedRectangle(cornerRadius: style.gridSize)
                .fill(theme.secondaryBackgroundColor)
                .frame(height: style.gridSize * 6)
                .overlay {
                    VStack(alignment: .leading, spacing: style.gridSize / 2) {
                        Capsule()
                            .fill(theme.loadingBackgroundColor)
                            .frame(width: style.gridSize * 18, height: style.gridSize)
                        Capsule()
                            .fill(theme.loadingBackgroundColor)
                            .frame(width: style.gridSize * 11, height: style.gridSize)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(style.gridSize)
                }
        }
    }
}

private struct StreamingMessageScaffold: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let chunkCount: Int

    var body: some View {
        HStack(spacing: style.gridSize) {
            ProgressView()
                .controlSize(.small)
                .tint(theme.secondaryLabelColor)

            Text("Streaming \(chunkCount.formatted()) chunks")
                .styledFont(.caption)
                .foregroundStyle(theme.secondaryLabelColor)
        }
        .padding(style.gridSize)
        .background(theme.secondaryBackgroundColor)
        .clipShape(RoundedRectangle(cornerRadius: style.gridSize, style: .continuous))
    }
}
