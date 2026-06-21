import API
import Combine
import Domain
import Entities
import Foundation

// swiftlint:disable file_length

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

    private(set) var connectionState: WebSocketConnectionState = .disconnected
    private(set) var messages: [SessionMessage] = []
    private(set) var assistantDisplayDataByMessageId: [String: MessageDisplayData] = [:]
    private(set) var streamingDisplayData: MessageDisplayData?
    @ObservationIgnored private var latestStreamingMessage: SessionMessage?
    @ObservationIgnored private var messageThrottler: SchedulerLatestValueThrottler<SessionMessage>?
    @ObservationIgnored private var textRenderCache = ChunkedTextRenderCache()
    private var streamAccumulator: SessionMessageStreamAccumulator?
    private var streamGeneration = 0
    private(set) var streamStatus = SessionMessageStreamStatus()
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
            || streamStatus.isActive
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
        resetPendingResponse()

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

        Task { [socket] in
            do {
                try await socket.sendChat(
                    content: content,
                    clientMessageId: clientMessageId
                )
                self.isSending = false
            } catch {
                self.recordSendError(error, submittedContent: content)
            }
        }
    }

    // swiftlint:disable:next cyclomatic_complexity
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
        case .connected(let status):
            clientState.status = status
        case .editorReady(let url):
            clientState.editorURL = url
        case .liveState(let state):
            applyLiveState(state)
        case .syncResponse(let snapshot):
            await applySyncResponse(snapshot)
        case .agentChunks(let chunks, let messageMetadata):
            await applyAgentChunks(chunks, messageMetadata: messageMetadata)
        case .agentFinish(let message):
            applyAgentFinish(message)
        case .userMessage(let message):
            applyUserMessage(message)
        case .agentReady:
            break
        }
    }

    private func applyLiveState(_ state: SessionClientState) {
        let previousProvider = clientState.agentSettings.provider
        clientState = state
        applyActiveTurnUserMessageId(state.activeTurnUserMessageId)
        if previousProvider != state.agentSettings.provider {
            rebuildTranscriptDisplayData()
        }
    }

    private func applySyncResponse(_ snapshot: SessionSyncSnapshot) async {
        if !hasLoadedMessages {
            hasLoadedMessages = true
        }
        let snapshotMessages = messagesIncludingOptimisticUserMessages(
            in: snapshot.messages
        )
        textRenderCache.reset()
        assistantDisplayDataByMessageId = assistantDisplayData(for: snapshotMessages)
        messages = snapshotMessages
        replaceStreamAccumulator()
        if snapshot.pendingChunks.isEmpty {
            clearStreamingState()
        } else {
            await streamAccumulator?.append(
                snapshot.pendingChunks,
                messageMetadata: snapshot.pendingMessageMetadata
            )
        }
        applyActiveTurnUserMessageId(snapshot.activeTurnUserMessageId)
        markLatestAssistantMessageRead(in: snapshotMessages)
    }

    private func applyAgentChunks(
        _ chunks: [SessionStreamChunk],
        messageMetadata: SessionStreamMessageMetadata?
    ) async {
        if streamAccumulator == nil {
            replaceStreamAccumulator()
        }

        await streamAccumulator?.append(chunks, messageMetadata: messageMetadata)
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
        let streamAccumulator = self.streamAccumulator
        Task {
            await streamAccumulator?.finish()
        }
        self.streamAccumulator = nil
        messageThrottler?.cancel()
        messageThrottler = nil
        streamGeneration += 1
        clearStreamingState()
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
            clearOptimisticUserMessageTracking()
        }
    }
}

extension AgentSessionViewModel {
    private func applyAgentFinish(_ message: SessionMessage) {
        messageThrottler?.flush()
        upsert(message)
        if message.role == .assistant {
            markReadIfNeeded(messageId: message.id)
        }
        clearOptimisticUserMessageTracking()
        resetPendingResponse()
    }

    private func applyUserMessage(_ message: SessionMessage) {
        upsertConfirmedUserMessage(message)
        isSending = false
        errorMessage = nil
    }

    /// Returns true if replaced, false if the message id was not found
    private func replaceMessage(id: String, with message: SessionMessage) -> Bool {
        guard let index = messages.firstIndex(where: { $0.id == id }) else {
            return false
        }
        messages[index] = message
        upsertDisplayData(for: message)
        return true
    }

    private func removeMessage(id: String) {
        messages.removeAll { $0.id == id }
    }

    private func appendPendingOptimisticUserMessage(content: String) -> String {
        let clientMessageId = UUID().uuidString.lowercased()
        let message = SessionMessage(
            id: clientMessageId,
            role: .user,
            text: content,
            metadata: .object(["optimistic": .bool(true)])
        )
        upsert(message)
        return clientMessageId
    }

    /// Replaces an optimistically client-set message with the server-side id
    private func acceptOptimisticUserMessage(clientMessageId: String, messageId: String) {
        guard let index = messages.firstIndex(where: { message in
            message.id == clientMessageId && message.isOptimisticUserMessage
        }) else {
            return
        }
        let optimisticMessage = messages[index]
        let acceptedMessage = SessionMessage(
            id: messageId,
            role: optimisticMessage.role,
            parts: optimisticMessage.parts,
            metadata: optimisticMessage.removingOptimisticMarker.metadata
        )
        messages[index] = acceptedMessage
    }

    private func upsertConfirmedUserMessage(_ message: SessionMessage) {
        // if we already have an optimistic message for this message, mutate and replace it
        // if not, just upsert
        guard let optimisticMessage = messages.first(where: {
            $0.isOptimisticUserMessage && isServerConfirmation(message, of: $0)
        }) else {
            upsert(message)
            return
        }

        if !replaceMessage(id: optimisticMessage.id, with: message) {
            upsert(message)
        }
    }

    private func messagesIncludingOptimisticUserMessages(
        in serverMessages: [SessionMessage]
    ) -> [SessionMessage] {
        var mergedMessages = serverMessages

        for optimisticMessage in messages where optimisticMessage.isOptimisticUserMessage {
            let hasServerMessage = serverMessages.contains {
                $0.id == optimisticMessage.id || isServerConfirmation($0, of: optimisticMessage)
            }
            if !hasServerMessage {
                mergedMessages.append(optimisticMessage)
            }
        }

        return mergedMessages
    }

    private func clearOptimisticUserMessageTracking() {
        for message in messages where message.isOptimisticUserMessage {
            _ = replaceMessage(id: message.id, with: message.removingOptimisticMarker)
        }
    }

    private func removePendingOptimisticUserMessage(
        restoreDraft: Bool,
        submittedContent: String? = nil
    ) {
        guard let optimisticMessage = messages.first(where: \.isOptimisticUserMessage) else {
            return
        }
        removeMessage(id: optimisticMessage.id)
        if restoreDraft {
            draftText = submittedContent ?? optimisticMessage.text
        }
    }

    private func isServerConfirmation(
        _ message: SessionMessage,
        of optimisticMessage: SessionMessage
    ) -> Bool {
        message.role == .user
            && message.id != optimisticMessage.id
            && message.text == optimisticMessage.text
    }
}

private extension AgentSessionViewModel {
    func replaceStreamAccumulator() {
        let previousAccumulator = streamAccumulator
        Task {
            await previousAccumulator?.finish()
        }
        messageThrottler?.cancel()
        streamGeneration += 1
        let generation = streamGeneration

        messageThrottler = SchedulerLatestValueThrottler(
            interval: .milliseconds(100),
            scheduler: .main
        ) { [weak self] message in
            guard let self, streamGeneration == generation else {
                return
            }
            applyStreamingMessage(message)
        }

        streamAccumulator = SessionMessageStreamAccumulator(
            onStatus: { [weak self] status in
                Task { @MainActor [weak self] in
                    guard let self, streamGeneration == generation else {
                        return
                    }
                    applyStreamStatus(status)
                }
            },
            onMessage: { [weak self] message in
                Task { @MainActor [weak self] in
                    guard let self, streamGeneration == generation else {
                        return
                    }
                    messageThrottler?.submit(message)
                }
            }
        )
    }

    func applyStreamStatus(_ status: SessionMessageStreamStatus) {
        guard streamStatus != status else {
            return
        }

        let previousErrorDescription = streamStatus.errorDescription
        streamStatus = status

        guard
            let errorDescription = status.errorDescription,
            errorDescription != previousErrorDescription
        else {
            return
        }

        errorMessage = errorDescription
    }

    func applyStreamingMessage(_ message: SessionMessage) {
        latestStreamingMessage = message
        rebuildStreamingDisplayData()
    }

    func clearStreamingState() {
        streamStatus = .init()
        latestStreamingMessage = nil
        streamingDisplayData = nil
    }

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
        guard let message = latestStreamingMessage else {
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
        var renderItems = transcriptBuilder.build(
            message: message,
            providerId: clientState.agentSettings.provider
        )
        renderItems = textRenderCache.renderItems(from: renderItems)
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
