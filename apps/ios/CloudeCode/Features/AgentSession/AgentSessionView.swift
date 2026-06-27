import Domain
import Entities
import SwiftUI

struct AgentSessionView: View {
    @Environment(\.theme) private var theme: Theme
    @Environment(\.style) private var style: Style

    @State private var store: AgentSessionViewModel
    @State private var destination: Modal<Destination>?
    @State private var composerHeight: CGFloat = 0
    @State private var transcriptScrollCoordinator = SessionTranscriptScrollCoordinator()

    init(store: AgentSessionViewModel) {
        _store = State(initialValue: store)
    }

    var body: some View {
        VStack(spacing: 0) {
            SessionScrollView(
                store: store,
                destination: $destination,
                keyboardDismissPadding: composerHeight,
                scrollCoordinator: transcriptScrollCoordinator
            )
            .safeSafeAreaBar(edge: .bottom) {
                ComposerView(vm: store)
                    .padding(.horizontal, style.horizontalPadding)
                    .padding(.bottom, style.spacing)
                    .readSize(updateComposerHeight)
            }
        }
        .overlay {
            ScrollBottomButton(
                scrollCoordinator: transcriptScrollCoordinator,
                composerHeight: composerHeight
            )
        }
        .background(theme.backgroundColor)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle(store.session.title ?? "Untitled session")
        .toolbar {
            ToolbarItem(placement: .principal) {
                sessionHeader
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
        .task {
            await store.bind()
        }
        .onDisappear {
            store.unbind()
        }
    }

    private func updateComposerHeight(_ size: CGSize) {
        guard abs(composerHeight - size.height) > 0.5 else { return }
        withAnimation(style.springAnimation) {
            composerHeight = size.height
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

private extension AgentSessionView {
    // Isolate coordinator observation so scroll-button visibility changes do not
    // invalidate the rest of AgentSessionView's body.
    struct ScrollBottomButton: View {
        let scrollCoordinator: SessionTranscriptScrollCoordinator
        let composerHeight: CGFloat

        var body: some View {
            VStack(spacing: 0) {
                Spacer(minLength: 0)

                if scrollCoordinator.showsScrollToBottom {
                    SessionTranscriptScrollToBottomButton {
                        scrollCoordinator.requestScrollToBottom()
                    }
                }

                Color.clear
                    .frame(height: bottomSpacerHeight)
                    .allowsHitTesting(false)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .allowsHitTesting(scrollCoordinator.showsScrollToBottom)
            .animation(.easeInOut(duration: 0.25), value: bottomSpacerHeight)
        }

        private var bottomSpacerHeight: CGFloat {
            composerHeight + 16
        }
    }

    struct WorkingIndicatorView: View {
        @Environment(\.style) private var style

        var body: some View {
            HStack {
                ProgressView()
                    .controlSize(.small)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, style.gridSize / 2)
            .accessibilityLabel("Agent is responding")
        }
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

private extension AgentSessionView {
    struct SessionScrollView: View {
        @Environment(\.style) private var style

        @State private var latestStreamingMessageId: String?
        @State private var autoCollapseMessageId: String?

        let store: AgentSessionViewModel
        @Binding var destination: Modal<AgentSessionView.Destination>?
        let keyboardDismissPadding: CGFloat
        let scrollCoordinator: SessionTranscriptScrollCoordinator

        var messages: [SessionMessage] {
            store.messages
        }

        var body: some View {
            if hasTranscriptItems {
//                SessionTranscriptPositionScrollView(
//                    items: transcriptItems,
//                    keyboardDismissPadding: keyboardDismissPadding,
//                    rowSpacing: style.spacing,
//                    contentPadding: style.spacing
//                ) { item in
//                    transcriptRow(item)
//                        .padding(.horizontal, style.horizontalPadding)
//                }
                transcriptScrollView
            } else {
                emptyScrollView
            }
        }

        private var hasTranscriptItems: Bool {
            !messages.isEmpty || store.streamingDisplayData != nil
        }

        private var transcriptItems: [SessionTranscriptItem] {
            var items = messages.compactMap { message -> SessionTranscriptItem? in
                if message.isUser {
                    return .userMessage(message)
                }

                guard let displayData = store.assistantDisplayDataByMessageId[message.id] else {
                    return nil
                }

                return .assistantMessage(
                    displayData,
                    isStreaming: false,
                    autoCollapse: autoCollapseMessageId == message.id
                )
            }

            if let streamingDisplayData = store.streamingDisplayData {
                items.append(.assistantMessage(
                    streamingDisplayData,
                    isStreaming: true,
                    autoCollapse: false
                ))
            }

            if store.isResponding {
                items.append(.workingIndicator)
            }

            return items
        }

        @ViewBuilder
        private var transcriptScrollView: some View {
            let scrollView = SessionTranscriptScrollView(
                items: transcriptItems,
                keyboardDismissPadding: keyboardDismissPadding,
                rowSpacing: style.spacing,
                contentPadding: style.spacing,
                scrollCoordinator: scrollCoordinator
            ) { item in
                transcriptRow(item)
                    .padding(.horizontal, style.horizontalPadding)
            }
            .onChange(of: store.streamingDisplayData?.id) { oldValue, newValue in
                handleStreamingMessageIdChange(oldValue: oldValue, newValue: newValue)
            }

            if #available(iOS 26.0, *) {
                scrollView
                    // necessary for scroll edge effects.
                    // we inset the content internally in the uiscrollview
                    .ignoresSafeArea(.container, edges: [.top, .bottom])
            } else {
                scrollView
                    .scrollClipDisabled()
            }
        }

        private var emptyScrollView: some View {
            ScrollView {
                if store.hasLoadedMessages {
                    ContentUnavailableView(
                        "No messages yet",
                        systemImage: "text.bubble"
                    )
                    .frame(maxWidth: .infinity, minHeight: style.gridSize * 30)
                } else {
                    // todo loading skeleton
                    ProgressView()
                        .containerRelativeFrame([.vertical, .horizontal])
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }

        @ViewBuilder
        private func transcriptRow(_ item: SessionTranscriptItem) -> some View {
            Group {
                switch item {
                case .userMessage(let message):
                    UserMessageView(message: message)
                        .environment(\.openAgentSessionImage, openImageAction)
                case .assistantMessage(let displayData, let isStreaming, let autoCollapse):
                    AssistantMessageView(
                        displayData: displayData,
                        isStreaming: isStreaming,
                        autoCollapseOnAppear: autoCollapse,
                        destination: $destination
                    ) {
                        if autoCollapse {
                            autoCollapseMessageId = nil
                        }
                    }
                case .workingIndicator:
                    WorkingIndicatorView()
                }
            }
        }

        private var openImageAction: OpenAgentSessionImageAction {
            OpenAgentSessionImageAction { image in
                destination = .fullscreen(.image(image))
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
