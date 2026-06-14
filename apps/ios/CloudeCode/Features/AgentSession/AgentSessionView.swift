import API
import Domain
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
                isResponding: store.isResponding,
                scrollTarget: $scrollTarget
            )
            .onChange(of: store.messages) { _, _ in
                scrollTarget = .bottom
            }
            .onChange(of: store.stream) { _, _ in
                scrollTarget = .bottom
            }
            .onChange(of: store.isResponding) { _, _ in
                scrollTarget = .bottom
            }

            Divider()

            PromptComposerView(
                text: $store.draftText,
                focused: $composerFocused,
                placeholder: store.composerPlaceholder,
                isSubmitDisabled: !store.canSubmitDraft,
                isSubmitting: store.isResponding,
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

                if store.isResponding {
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

    let messages: [SessionMessage]
    let stream: SessionMessageStreamState
    let isResponding: Bool
    @Binding var scrollTarget: SessionScrollTarget?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: style.spacing) {
                let visibleMessages = messages.filter { !$0.text.isEmpty }
                let streamingText = stream.text

                if visibleMessages.isEmpty, streamingText.isEmpty, !isResponding {
                    ContentUnavailableView(
                        "No messages yet",
                        systemImage: "text.bubble"
                    )
                    .frame(maxWidth: .infinity, minHeight: style.gridSize * 30)
                } else {
                    ForEach(visibleMessages) { message in
                        MessageTextRow(
                            text: message.text,
                            isUser: message.isUser
                        )
                        .id(SessionScrollTarget.message(message.id))
                    }

                    if !streamingText.isEmpty {
                        MessageTextRow(text: streamingText, isUser: false)
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

private struct MessageTextRow: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let text: String
    let isUser: Bool

    var body: some View {
        if isUser {
            HStack(alignment: .top) {
                Spacer(minLength: style.gridSize * 5)
                Text(verbatim: text)
                    .styledFont(.body)
                    .foregroundStyle(theme.labelColor)
                    .textSelection(.enabled)
                    .padding(style.gridSize)
                    .background(theme.secondaryBackgroundColor)
                    .clipShape(userMessageShape)
            }
        } else {
            Text(verbatim: text)
                .styledFont(.body)
                .foregroundStyle(theme.labelColor)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var userMessageShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: style.gridSize * 1.5, style: .continuous)
    }
}
