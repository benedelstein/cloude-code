import API
import Domain
import Entities
import Foundation

@MainActor
@Observable
final class AgentSessionViewModel {
    typealias MessageDisplayData = AgentSessionView.MessageDisplayData
    /// Canonical cached model — updates from the cache/socket propagate here. (reference type)
    let session: SessionSummaryModel

    private let socket: SessionSocket
    private let transcriptBuilder: any AgentSessionTranscriptBuilding
    private var subscriptionTask: Task<Void, Never>?
    private var hasSeenServerActiveTurn = false
    private var lastMarkReadSentMessageId: String?
    var pendingOptimisticUserMessage: SessionMessage?

    private(set) var connectionState: WebSocketConnectionState = .disconnected
    private(set) var messages: [SessionMessage] = []
    private(set) var assistantDisplayDataByMessageId: [String: MessageDisplayData] = [:]
    private(set) var streamingDisplayData: MessageDisplayData?
    private(set) var stream = SessionMessageStreamState()
    private(set) var clientState = SessionClientState.empty
    private(set) var isSending = false
    private(set) var isWaitingForResponse = false
    private(set) var hasLoadedMessages: Bool = false
    var draftText = ""
    var errorMessage: String?

    var canSubmitDraft: Bool {
        !draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && connectionState == .connected
            && !isSending
            && !isResponding
    }

    var isResponding: Bool {
        isWaitingForResponse
            || stream.isActive
            || clientState.activeTurnUserMessageId != nil
    }

    var isConnected: Bool {
        connectionState == .connected
    }

    var composerPlaceholder: String {
        switch connectionState {
        case .connecting:
            "Connecting..."
        case .connected:
            isResponding ? "Agent is responding..." : "Send a message..."
        case .disconnected:
            "Reconnecting..."
        }
    }

    init(
        session: SessionSummaryModel,
        socket: SessionSocket,
        transcriptBuilder: any AgentSessionTranscriptBuilding
    ) {
        self.session = session
        self.socket = socket
        self.transcriptBuilder = transcriptBuilder
    }

    func bind() {
        guard subscriptionTask == nil else {
            return
        }
        // Future caching work should load cached messages before replacing them with socket values.

        subscriptionTask = Task { [weak self, socket] in
            await socket.connect()
            for await event in socket.events {
                guard !Task.isCancelled else {
                    return
                }
                await self?.handle(event)
            }
        }
    }

    func unbind() {
        subscriptionTask?.cancel()
        subscriptionTask = nil
        connectionState = .disconnected

        Task { [socket] in
            await socket.disconnect()
        }
    }

    func submitDraft() {
        let content = draftText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty, !isSending, !isResponding else {
            return
        }

        draftText = ""
        let clientMessageId = appendPendingOptimisticUserMessage(content: content)
        isSending = true
        isWaitingForResponse = true
        errorMessage = nil

        Task { [weak self, socket] in
            do {
                try await socket.sendChat(
                    content: content,
                    clientMessageId: clientMessageId
                )
                self?.finishSending()
            } catch {
                self?.recordSendError(error, submittedContent: content)
            }
        }
    }

    private func handle(_ event: SessionSocketEvent) async {
        switch event {
        case .connectionChanged(let state):
            Logger.debug("Agent session socket state changed:", "\(state)")
            connectionState = state
            if state == .disconnected {
                resetPendingResponse()
            }
        case .operationError(let operationError):
            errorMessage = operationError.message
            removePendingOptimisticUserMessage(restoreDraft: draftText.isEmpty)
            resetPendingResponse()
        case .chatAccepted(let clientMessageId, let messageId):
            acceptOptimisticUserMessage(
                clientMessageId: clientMessageId,
                messageId: messageId
            )
        case .agentReady:
            break
        case .connected, .editorReady, .liveState:
            applyLiveState(event)
        case .syncResponse, .agentChunks, .agentFinish, .userMessage:
            await applyTranscriptEvent(event)
        }
    }

    private func applyLiveState(_ event: SessionSocketEvent) {
        switch event {
        case .connected(let status):
            clientState.status = status
        case .editorReady(let url):
            clientState.editorURL = url
        case .liveState(let state):
            let previousProvider = clientState.agentSettings.provider
            clientState = state
            applyActiveTurnUserMessageId(state.activeTurnUserMessageId)
            if previousProvider != state.agentSettings.provider {
                rebuildTranscriptDisplayData()
            }
        case .connectionChanged, .syncResponse, .operationError, .chatAccepted,
             .agentChunks, .agentFinish, .agentReady, .userMessage:
            break
        }
    }

    private func applyTranscriptEvent(_ event: SessionSocketEvent) async {
        switch event {
        case .syncResponse(let snapshot):
            if !hasLoadedMessages {
                hasLoadedMessages = true
            }
            let snapshotMessages = messagesIncludingPendingOptimisticUserMessage(
                in: snapshot.messages
            )
            assistantDisplayDataByMessageId = assistantDisplayData(for: snapshotMessages)
            messages = snapshotMessages
            stream = await SessionMessageStreamState.reducing(
                snapshot.pendingChunks,
                messageMetadata: snapshot.pendingMessageMetadata
            )
            rebuildStreamingDisplayData()
            applyActiveTurnUserMessageId(snapshot.activeTurnUserMessageId)
            markLatestAssistantMessageRead(in: snapshotMessages)
        case .agentChunks(let chunks, let messageMetadata):
            stream = await stream.appending(chunks, messageMetadata: messageMetadata)
            rebuildStreamingDisplayData()
        case .agentFinish(let message):
            upsert(message)
            if message.role == .assistant {
                markReadIfNeeded(messageId: message.id)
            }
            clearPendingOptimisticUserMessageTracking()
            resetPendingResponse()
        case .userMessage(let message):
            upsertConfirmedUserMessage(message)
            isSending = false
            errorMessage = nil
        case .connectionChanged, .connected, .operationError, .chatAccepted, .agentReady, .editorReady, .liveState:
            break
        }
    }

    func upsert(_ message: SessionMessage) {
        upsertDisplayData(for: message)
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            messages[index] = message
        } else {
            messages.append(message)
        }
    }

    private func markLatestAssistantMessageRead(in messages: [SessionMessage]) {
        guard let messageId = messages.reversed().first(where: { $0.role == .assistant })?.id else {
            return
        }
        markReadIfNeeded(messageId: messageId)
    }

    private func markReadIfNeeded(messageId: String) {
        guard lastMarkReadSentMessageId != messageId else {
            return
        }
        lastMarkReadSentMessageId = messageId
        clearUnreadIfCurrentAssistantMessage(messageId)

        Task { [socket, messageId] in
            do {
                try await socket.markRead(messageId: messageId)
            } catch {
                Logger.warning("Failed to mark session read:", error)
            }
        }
    }

    private func clearUnreadIfCurrentAssistantMessage(_ messageId: String) {
        guard session.lastAssistantMessageId == messageId else {
            return
        }
        session.hasUnread = false
        // Persisting unread state belongs with the session summary store once that dependency is available.
        // sessionSummaryStore.putDisk(session)
    }

    private func finishSending() {
        isSending = false
    }

    private func recordSendError(
        _ error: any Error,
        submittedContent: String
    ) {
        errorMessage = error.localizedDescription
        removePendingOptimisticUserMessage(
            restoreDraft: draftText.isEmpty,
            submittedContent: submittedContent
        )
        resetPendingResponse()
    }

    private func resetPendingResponse() {
        stream = SessionMessageStreamState()
        streamingDisplayData = nil
        clientState.activeTurnUserMessageId = nil
        isSending = false
        isWaitingForResponse = false
        hasSeenServerActiveTurn = false
    }

    private func applyActiveTurnUserMessageId(_ userMessageId: String?) {
        clientState.activeTurnUserMessageId = userMessageId
        if userMessageId != nil {
            hasSeenServerActiveTurn = true
            return
        }
        if hasSeenServerActiveTurn {
            hasSeenServerActiveTurn = false
            isWaitingForResponse = false
            clearPendingOptimisticUserMessageTracking()
        }
    }
}

extension AgentSessionViewModel {
    func replaceMessage(id: String, with message: SessionMessage) -> Bool {
        guard let index = messages.firstIndex(where: { $0.id == id }) else {
            return false
        }
        messages[index] = message
        return true
    }

    func removeMessage(id: String) {
        messages.removeAll { $0.id == id }
    }
}

private extension AgentSessionViewModel {
    func rebuildTranscriptDisplayData() {
        rebuildAssistantDisplayData()
        rebuildStreamingDisplayData()
    }

    func rebuildAssistantDisplayData() {
        assistantDisplayDataByMessageId = assistantDisplayData(for: messages)
    }

    func assistantDisplayData(
        for messages: [SessionMessage]
    ) -> [String: AgentSessionView.MessageDisplayData] {
        messages.reduce(into: [:]) { result, message in
            guard message.role != .user else {
                return
            }
            result[message.id] = makeDisplayData(for: message, isStreaming: false)
        }
    }

    private func rebuildStreamingDisplayData() {
        guard let message = stream.message else {
            streamingDisplayData = nil
            return
        }
        streamingDisplayData = makeDisplayData(for: message, isStreaming: true)
    }

    private func upsertDisplayData(for message: SessionMessage) {
        guard message.role == .assistant else {
            assistantDisplayDataByMessageId[message.id] = nil
            return
        }
        assistantDisplayDataByMessageId[message.id] = makeDisplayData(for: message, isStreaming: false)
    }

    private func makeDisplayData(
        for message: SessionMessage,
        isStreaming: Bool
    ) -> AgentSessionView.MessageDisplayData {
        let renderItems = transcriptBuilder.build(
            message: message,
            providerId: clientState.agentSettings.provider
        )
        let finalResponseStartIndex = isStreaming ? nil : transcriptBuilder.finalResponseStartIndex(
            renderItems: renderItems
        )

        return AgentSessionView.MessageDisplayData(
            message: message,
            renderItems: renderItems,
            finalResponseStartIndex: finalResponseStartIndex
        )
    }
}
