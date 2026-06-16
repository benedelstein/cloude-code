import API
import Domain
import Entities
import SwiftUI

struct AgentSessionView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    @State private var store: AgentSessionViewModel
    @State private var scrollTarget: SessionScrollTarget? = .bottom
    @FocusState private var composerFocused: Bool

    init(store: AgentSessionViewModel) {
        _store = State(initialValue: store)
    }

    var body: some View {
        VStack(spacing: 0) {
//            sessionHeader
//                .padding(.horizontal, style.horizontalPadding)
//                .padding(.vertical, style.gridSize)

            SessionScrollView(
                store: store,
                scrollTarget: $scrollTarget
            )
            .onChange(of: store.isResponding) { _, _ in
                scrollTarget = .bottom
            }
            .safeSafeAreaBar(edge: .bottom) {
                PromptComposerView(
                    text: $store.draftText,
                    focused: $composerFocused,
                    placeholder: store.composerPlaceholder,
                    isSubmitDisabled: !store.canSubmitDraft,
                    isSubmitting: store.isResponding,
                    onSubmit: store.submitDraft
                )
                .padding(.horizontal, style.horizontalPadding)
                .padding(.bottom, style.gridSize)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle(store.session.title ?? "Untitled session")
        .toolbar {
            ToolbarItem(placement: .principal) {
                header
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                } label: {
                    Image(systemName: "ellipsis")
                }
            }
        }
        .toolbarTitleDisplayMode(.inline)
        .onAppear {
            store.bind()
        }
        .onDisappear {
            store.unbind()
        }
    }

    private var header: some View {
        HStack {
            sessionHeader
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

private struct SessionScrollView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let store: AgentSessionViewModel
    @Binding var scrollTarget: SessionScrollTarget?

    var messages: [SessionMessage] {
        store.messages
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: style.spacing) {
                let visibleMessages = messages
                let streamingText = store.stream.text

                if visibleMessages.isEmpty, streamingText.isEmpty, !store.isResponding, store.hasLoadedMessages {
                    ContentUnavailableView(
                        "No messages yet",
                        systemImage: "text.bubble"
                    )
                    .frame(maxWidth: .infinity, minHeight: style.gridSize * 30)
                } else {
                    ForEach(visibleMessages) { message in
                        if message.isUser {
                            UserMessageView(message: message)
                        } else {
                            AssistantMessageView(message: message, clientState: store.clientState)
                        }
//                            .id(SessionScrollTarget.message(message.id))
                    }

                    if let streamingMessage = store.stream.message {
                        AssistantMessageView(message: streamingMessage, clientState: store.clientState)
                            .id(SessionScrollTarget.stream)
                    }
                }

                Color.clear
                    .frame(height: 1)
                    .id(SessionScrollTarget.bottom)
            }
//            .scrollTargetLayout()
            .padding(style.horizontalPadding)
        }
        .defaultScrollAnchor(.bottom)
//        .scrollPosition(id: $scrollTarget, anchor: .bottom)
        .scrollDismissesKeyboard(.immediately)
    }
}

private struct AssistantMessageView: View {
    let message: SessionMessage
    let clientState: SessionClientState
    @State private var destination: AgentSessionToolDetailDestination?

    private var renderItems: [AgentSessionRenderItem] {
        AgentSessionTranscriptBuilder.build(message: message, clientState: clientState)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(renderItems, id: \.key) { item in
                AgentSessionRenderItemView(item: item) {
                    destination = .renderItem(item)
                }
            }
        }
        .sheet(item: $destination) { destination in
            AgentSessionToolDetailSheet(destination: destination)
                .presentationDetents([.medium, .large])
        }
    }
}
