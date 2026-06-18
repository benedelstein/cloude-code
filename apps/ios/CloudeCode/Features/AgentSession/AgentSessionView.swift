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
                bottomBar
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

    private var bottomBar: some View {
        VStack(spacing: style.gridSize) {
            if store.isResponding {
                AgentSessionWorkingIndicatorView()
                    .transition(.opacity)
            }

            composer
        }
        .animation(style.springAnimation, value: store.isResponding)
    }

    private var header: some View {
        HStack {
            sessionHeader
        }
    }

    private var sessionHeader: some View {
        VStack(alignment: .center, spacing: 0) {
            Text(store.session.title ?? "Untitled session")
                .styledFont(.headline)
                .foregroundStyle(theme.labelColor)
                .lineLimit(1)

            HStack(spacing: style.gridSize) {
                Text(store.clientState.repoFullName ?? store.session.repoFullName)
                    .lineLimit(1)
            }
            .styledFont(.caption)
            .foregroundStyle(theme.secondaryLabelColor)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct AgentSessionWorkingIndicatorView: View {
    @Environment(\.style) private var style

    var body: some View {
        HStack {
            ProgressView()
                .controlSize(.small)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, style.horizontalPadding)
        .accessibilityLabel("Agent is responding")
    }
}

private extension AgentSessionView {
    var composer: some View {
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

extension AgentSessionView {
    struct MessageDisplayData: Identifiable, Equatable {
        let message: SessionMessage
        let renderItems: [AgentSessionRenderItem]
        let finalResponseStartIndex: Int?

        var id: String {
            message.id
        }
    }
}

private enum SessionScrollTarget: Hashable {
    case message(String)
    case stream
    case bottom
}

private extension AgentSessionView {
    struct SessionScrollView: View {
        @Environment(\.theme) private var theme
        @Environment(\.style) private var style

        @State private var latestStreamingMessageId: String?
        @State private var autoCollapseMessageId: String?

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

                    if visibleMessages.isEmpty,
                       store.streamingDisplayData == nil,
                       !store.isResponding,
                       store.hasLoadedMessages {
                        ContentUnavailableView(
                            "No messages yet",
                            systemImage: "text.bubble"
                        )
                        .frame(maxWidth: .infinity, minHeight: style.gridSize * 30)
                    } else {
                        ForEach(visibleMessages) { message in
                            if message.isUser {
                                UserMessageView(message: message)
                            } else if let displayData = store.assistantDisplayDataByMessageId[message.id] {
                                AssistantMessageView(
                                    displayData: displayData,
                                    isStreaming: false,
                                    autoCollapseOnAppear: autoCollapseMessageId == message.id,
                                    destination: $destination
                                ) {
                                    if autoCollapseMessageId == message.id {
                                        autoCollapseMessageId = nil
                                    }
                                }
                            }
                        }

                        if let streamingDisplayData = store.streamingDisplayData {
                            AssistantMessageView(
                                displayData: streamingDisplayData,
                                isStreaming: true,
                                autoCollapseOnAppear: false,
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
            .onChange(of: store.streamingDisplayData?.id) { oldValue, newValue in
                handleStreamingMessageIdChange(oldValue: oldValue, newValue: newValue)
            }
        }

        private func handleStreamingMessageIdChange(oldValue: String?, newValue: String?) {
            if let newValue {
                latestStreamingMessageId = newValue
                return
            }

            if let finishedMessageId = oldValue ?? latestStreamingMessageId {
                autoCollapseMessageId = finishedMessageId
            }
            latestStreamingMessageId = nil
        }
    }
}
