import API
import Domain
import Entities
import SwiftUI

struct AgentSessionView: View {
    @Environment(\.theme) private var theme: Theme
    @Environment(\.style) private var style: Style

    @State private var store: AgentSessionViewModel
    @FocusState private var composerFocused: Bool
    @State private var destination: Modal<Destination>?
    @State private var composerHeight: CGFloat = 0

    init(store: AgentSessionViewModel) {
        _store = State(initialValue: store)
    }

    var body: some View {
        VStack(spacing: 0) {
//            ScrollView {
//                ForEach(store.messages) { message in
//                    Text("Message" + message.text)
//                }
//            }
            SessionScrollView(
                store: store,
                destination: $destination,
                keyboardDismissPadding: composerHeight
            )
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
                .readSize { size in
                    guard abs(composerHeight - size.height) > 0.5 else { return }
                    composerHeight = size.height
                }
            }
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
        .onAppear {
            store.bind()
        }
        .onDisappear {
            store.unbind()
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

        var messages: [SessionMessage] {
            store.messages
        }

        var body: some View {
            if hasTranscriptItems {
//                SessionTranscriptFlippedScrollView(
//                    items: transcriptItems,
//                    keyboardDismissPadding: keyboardDismissPadding,
//                    rowSpacing: style.spacing,
//                    contentPadding: style.spacing
//                ) { item in
//                    transcriptRow(item)
//                        .padding(.horizontal, style.horizontalPadding)
//                }
                SessionTranscriptPositionScrollView(
                    items: transcriptItems,
                    keyboardDismissPadding: keyboardDismissPadding,
                    rowSpacing: style.spacing,
                    contentPadding: style.spacing
                ) { item in
                    transcriptRow(item)
                        .padding(.horizontal, style.horizontalPadding)
                }
//                transcriptScrollView
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
                contentPadding: style.spacing
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
//                    .scrollClipDisabled()
//                    .scrollEdgeEffectStyle(.soft, for: [.top, .bottom])
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
            switch item {
            case .userMessage(let message):
                UserMessageView(message: message)
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
