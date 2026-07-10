import Domain
import Entities
import SwiftUI

struct AgentSessionView: View {
    @Environment(\.theme) private var theme: Theme
    @Environment(\.style) private var style: Style
    @Environment(\.showToast) private var showToast

    @State private var store: AgentSessionViewModel
    @State private var destination: Modal<Destination>?
    @State private var composerHeight: CGFloat = 0
    @State private var transcriptScrollCoordinator = SessionTranscriptScrollCoordinator()
    private let onSessionCreated: ((String) -> Void)?

    init(
        store: AgentSessionViewModel,
        onSessionCreated: ((String) -> Void)? = nil
    ) {
        _store = State(initialValue: store)
        self.onSessionCreated = onSessionCreated
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
        .navigationTitle(navigationTitle)
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
        .onChange(of: store.errorMessage) { _, errorMessage in
            guard let errorMessage else {
                return
            }
            showToast?(
                title: Text(verbatim: errorMessage),
                icon: Image(systemName: "exclamationmark.circle.fill")
            )
        }
        .onChange(of: store.session?.id) { _, sessionId in
            guard let sessionId else {
                return
            }
            onSessionCreated?(sessionId)
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
            Text(navigationTitle)
                .styledFont(.headline)
                .foregroundStyle(theme.labelColor)
                .lineLimit(1)

            HStack(spacing: style.gridSize) {
                Text(store.clientState.repoFullName ?? store.session?.repoFullName ?? "No repository selected")
                    .lineLimit(1)
            }
            .styledFont(.caption)
            .foregroundStyle(theme.secondaryLabelColor)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var navigationTitle: String {
        store.session?.title ?? (store.isDraftMode ? "New session" : "Untitled session")
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
}

extension AgentSessionView {
    struct MessageDisplayData: Identifiable, Equatable {
        let id: String
        let message: SessionMessage
        let renderItems: [AgentSessionRenderItem]
        let finalResponseStartIndex: Int?
    }

    // Keep collection row identity separate from SessionMessage.id. A streaming
    // assistant row starts before the server id exists, then receives the final
    // message id; preserving this row id avoids delete/insert churn and cell jumps.
    // The message content lives in the view model's `messagesByID`.
    struct TranscriptRow: Identifiable, Equatable {
        let id: String
        var messageID: String
        var isStreaming: Bool
    }
}

private extension AgentSessionView {
    struct SessionScrollView: View {
        @Environment(\.style) private var style

        let store: AgentSessionViewModel
        @Binding var destination: Modal<AgentSessionView.Destination>?
        let keyboardDismissPadding: CGFloat
        let scrollCoordinator: SessionTranscriptScrollCoordinator

        var rows: [AgentSessionView.TranscriptRow] {
            store.transcriptRows
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

        private var hasMessageTranscriptItems: Bool {
            !rows.isEmpty
        }

        private var hasTranscriptItems: Bool {
            hasMessageTranscriptItems || isWorkingIndicatorActive
        }

        private var isWorkingIndicatorActive: Bool {
            store.isResponding || store.clientState.sessionSetupRun?.status == "running"
        }

        private var transcriptItems: [SessionTranscriptItem] {
            // TranscriptRow.id is the stable row id assigned when the row is
            // created (streaming assistant rows and optimistic user rows keep it
            // when the server id arrives), so rows never churn identity.
            var items = rows.compactMap { row -> SessionTranscriptItem? in
                guard let message = store.messagesByID[row.messageID] else {
                    assertionFailure("Transcript row \(row.id) has no message \(row.messageID)")
                    return nil
                }
                if message.isUser {
                    return .userMessage(id: row.id, message)
                }

                guard let displayData = store.assistantDisplayDataByRowID[row.id] else {
                    return nil
                }

                return .assistantMessage(
                    id: row.id,
                    displayData,
                    isStreaming: row.isStreaming
                )
            }

            if hasTranscriptItems {
                // Keep this row mounted even when inactive so the cloud can settle
                // into its resting state instead of disappearing between turns.
                items.append(.workingIndicator(isActive: isWorkingIndicatorActive))
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
//                    ContentUnavailableView(
//                        "No messages yet",
//                        systemImage: "text.bubble"
//                    )
//                    .frame(maxWidth: .infinity, minHeight: style.gridSize * 30)
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
                case .userMessage(_, let message):
                    UserMessageView(message: message)
                        .environment(\.openAgentSessionImage, openImageAction)
                case .assistantMessage(_, let displayData, let isStreaming):
                    AssistantMessageView(
                        displayData: displayData,
                        isStreaming: isStreaming,
                        destination: $destination
                    )
                case .workingIndicator(let isActive):
                    WorkingIndicatorView(isActive: isActive)
                }
            }
            // Rows are hosted inside reused UIKit cells; the stable row id gives
            // SwiftUI explicit identity so state doesn't leak across cell reuse.
            // see https://lucasvandongen.dev/swiftui_uitableviewcell_reuse_id.php
            .id(item.id)
        }

        private var openImageAction: OpenAgentSessionImageAction {
            OpenAgentSessionImageAction { image in
                destination = .fullscreen(.image(image))
            }
        }
    }
}
