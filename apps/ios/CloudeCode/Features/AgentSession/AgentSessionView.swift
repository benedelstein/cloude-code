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
    @State private var destination: Modal<Destination>?

    init(store: AgentSessionViewModel) {
        _store = State(initialValue: store)
    }

    var body: some View {
        VStack(spacing: 0) {
            SessionScrollView(
                store: store,
                destination: $destination,
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
        .modifier(Destinations(destination: $destination))
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
        VStack(alignment: .center) {
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
    @Binding var destination: Modal<AgentSessionView.Destination>?
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
                            AssistantMessageView(
                                message: message,
                                clientState: store.clientState,
                                isStreaming: false,
                                destination: $destination
                            )
                        }
//                            .id(SessionScrollTarget.message(message.id))
                    }

                    if let streamingMessage = store.stream.message {
                        AssistantMessageView(
                            message: streamingMessage,
                            clientState: store.clientState,
                            isStreaming: true,
                            destination: $destination
                        )
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
    let isStreaming: Bool
    @Binding var destination: Modal<AgentSessionView.Destination>?

    private var renderItems: [AgentSessionRenderItem] {
        AgentSessionTranscriptBuilder.build(message: message, clientState: clientState)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            let items = renderItems
            ForEach(Array(items.enumerated()), id: \.element.key) { index, item in
                let isActive = isActiveFinalGroup(
                    item: item,
                    index: index,
                    items: items
                )

                AgentSessionRenderItemView(
                    item: item,
                    isActive: isActive
                ) {
                    destination = .sheet(.renderItem(item))
                }
            }
        }
    }

    private func isActiveFinalGroup(
        item: AgentSessionRenderItem,
        index: Int,
        items: [AgentSessionRenderItem]
    ) -> Bool {
        guard isStreaming, index == items.endIndex - 1 else {
            return false
        }
        if case .actionItem(.group) = item {
            return true
        }
        return false
    }
}
