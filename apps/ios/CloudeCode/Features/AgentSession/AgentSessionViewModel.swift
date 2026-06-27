import API
import Combine
import Domain
import Entities
import Foundation
import PhotosUI
import SwiftUI
import UIKit

// swiftlint:disable file_length

/// Coordinates session state, transcript rendering, composer drafts, and socket events.
@MainActor
@Observable
final class AgentSessionViewModel {
    typealias MessageDisplayData = AgentSessionView.MessageDisplayData
    /// Canonical cached model — updates from the cache/socket propagate here. (reference type)
    let session: SessionSummaryModel

    private let socket: SessionSocket
    private let sessionMessageStore: SessionMessageStore
    private let transcriptBuilder: any AgentSessionTranscriptBuilding
    private var subscriptionTask: Task<Void, Never>?
    private var hasSeenServerActiveTurn = false
    private var lastMarkReadSentMessageId: String?
    // Keeps the local upload drafts for an optimistic message so they can be
    // restored if send fails after the composer has already been cleared.
    @ObservationIgnored private var submittedAttachmentDrafts: [String: [ImageAttachmentDraft]] = [:]

    private let attachmentStore: ImageAttachmentStore
    private(set) var connectionState: WebSocketConnectionState = .disconnected
    private(set) var messages: [SessionMessage] = []
    /// Hydrated, normalized display data per message
    private(set) var assistantDisplayDataByMessageId: [String: MessageDisplayData] = [:]
    /// Display data for the currently streaming message.
    private(set) var streamingDisplayData: MessageDisplayData?
    @ObservationIgnored private var latestStreamingMessage: SessionMessage?
    @ObservationIgnored private var messageThrottler: SchedulerLatestValueThrottler<SessionMessage>?
    @ObservationIgnored private let textRenderCache = ChunkedTextRenderCache()
    private var streamAccumulator: SessionMessageStreamAccumulator?
    /// Guard so that we do not accumulate to a stream that is no longer active
    private var streamGeneration = 0
    private(set) var streamStatus = SessionMessageStreamStatus()
    // Future optimization: cache a curated subset of client state
    // if needed. Do not persist raw SessionClientState; active turns,
    // pending work, editor readiness, and transient errors are live state.
    private(set) var clientState = SessionClientState.empty
    /// Message send is in progress
    private(set) var isSending = false
    /// Waiting for a message stream response from server.
    /// Set to true after we send a message
    private(set) var isWaitingForResponse = false
    private(set) var hasLoadedMessages: Bool = false
    var draftText = ""
    var errorMessage: String?

    var canSubmitDraft: Bool {
        let hasContent = !draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !attachmentStore.attachments.isEmpty
        return hasContent
            && !attachmentStore.hasPendingOrFailedUploads
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
        sessionMessageStore: SessionMessageStore,
        transcriptBuilder: any AgentSessionTranscriptBuilding,
        attachmentsAPI: any AttachmentsAPIProviding
    ) {
        self.session = session
        self.socket = socket
        self.sessionMessageStore = sessionMessageStore
        self.transcriptBuilder = transcriptBuilder
        attachmentStore = ImageAttachmentStore(
            sessionId: session.id,
            attachmentsAPI: attachmentsAPI
        )
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
            restoreLastSubmittedAttachments()
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
        do {
            try await sessionMessageStore.replace(
                sessionId: session.id,
                with: snapshot.messages
            )
        } catch {
            Logger.warning("Failed to replace session message cache:", error)
        }
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
        submittedContent: String,
        submittedAttachments: [ImageAttachmentDraft],
        clientMessageId: String
    ) {
        errorMessage = error.localizedDescription
        submittedAttachmentDrafts[clientMessageId] = nil
        removePendingOptimisticUserMessage(
            restoreDraft: draftText.isEmpty,
            submittedContent: submittedContent
        )
        attachmentStore.restore(submittedAttachments)
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
    /// Image drafts currently shown by the composer attachment strip.
    var imageAttachmentDrafts: [ImageAttachmentDraft] {
        attachmentStore.attachments
    }

    /// Transient composer error for image selection or validation failures.
    var imageSelectionErrorMessage: String? {
        attachmentStore.errorMessage
    }

    /// Number of additional image attachments the composer can accept.
    var remainingImageAttachmentSlots: Int {
        attachmentStore.remainingSlots
    }

    /// Adds selected Photos items and starts uploading each loaded image.
    func addImageAttachmentPhotoItems(_ items: [PhotosPickerItem]) {
        attachmentStore.addPhotoItems(items)
    }

    /// Adds a captured camera image and starts uploading it.
    func addImageAttachmentCameraImage(_ image: UIImage) {
        attachmentStore.addCameraImage(image)
    }

    /// Removes an image draft from the composer and cleans up uploaded data if needed.
    func removeImageAttachment(id: UUID) {
        attachmentStore.removeAttachment(id: id)
    }

    /// Retries a failed image attachment upload.
    func retryImageAttachment(id: UUID) {
        attachmentStore.retryAttachment(id: id)
    }
}

extension AgentSessionViewModel {
    /// Submit the composed message.
    func submitDraft() {
        let content = draftText.trimmingCharacters(in: .whitespacesAndNewlines)
        let uploadedAttachments = attachmentStore.uploadedDescriptors
        guard !content.isEmpty || !uploadedAttachments.isEmpty,
              !attachmentStore.hasPendingOrFailedUploads,
              !isSending,
              !isResponding else {
            return
        }

        let submittedDrafts = attachmentStore.attachments
        draftText = ""
        attachmentStore.clearAfterSubmit()
        let clientMessageId = appendPendingOptimisticUserMessage(
            content: content,
            attachments: uploadedAttachments
        )
        submittedAttachmentDrafts[clientMessageId] = submittedDrafts
        isSending = true
        isWaitingForResponse = true
        errorMessage = nil

        Task { [socket, uploadedAttachments] in
            do {
                try await socket.sendChat(
                    content: content.isEmpty ? nil : content,
                    attachmentIds: uploadedAttachments.map(\.attachmentId),
                    clientMessageId: clientMessageId
                )
                self.isSending = false
            } catch {
                self.recordSendError(
                    error,
                    submittedContent: content,
                    submittedAttachments: submittedDrafts,
                    clientMessageId: clientMessageId
                )
            }
        }
    }
}

extension AgentSessionViewModel {
    func bind() async {
        guard subscriptionTask == nil else {
            return
        }

        let task = Task { [weak self, socket] in
            await self?.loadCachedMessages()
            guard !Task.isCancelled else {
                return
            }
            await socket.connect()
            for await event in socket.events {
                guard !Task.isCancelled else {
                    return
                }
                await self?.handle(event)
            }
        }
        subscriptionTask = task
        await task.value
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
}

extension AgentSessionViewModel {
    private func applyAgentFinish(_ message: SessionMessage) {
        messageThrottler?.flush()
        upsert(message)
        sessionMessageStore.upsert(sessionId: session.id, message: message)
        if message.role == .assistant {
            markReadIfNeeded(messageId: message.id)
        }
        clearOptimisticUserMessageTracking()
        resetPendingResponse()
    }

    private func applyUserMessage(_ message: SessionMessage) {
        upsertConfirmedUserMessage(message)
        sessionMessageStore.upsert(sessionId: session.id, message: message)
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

    private func appendPendingOptimisticUserMessage(
        content: String,
        attachments: [UploadedAttachment]
    ) -> String {
        let clientMessageId = UUID().uuidString.lowercased()
        let message = SessionMessage(
            id: clientMessageId,
            role: .user,
            parts: optimisticUserMessageParts(
                content: content,
                attachments: attachments
            ),
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
        submittedAttachmentDrafts[clientMessageId] = nil
        let optimisticMessage = messages[index]
        let acceptedMessage = SessionMessage(
            id: messageId,
            role: optimisticMessage.role,
            parts: optimisticMessage.parts,
            metadata: optimisticMessage.removingOptimisticMarker.metadata
        )
        messages[index] = acceptedMessage
        sessionMessageStore.upsert(sessionId: session.id, message: acceptedMessage)
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
            && imageFileURLs(in: message) == imageFileURLs(in: optimisticMessage)
    }

    private func optimisticUserMessageParts(
        content: String,
        attachments: [UploadedAttachment]
    ) -> [SessionMessage.Part] {
        var parts: [SessionMessage.Part] = []
        if !content.isEmpty {
            parts.append(.text(.init(text: content)))
        }
        parts.append(contentsOf: attachments.map { attachment in
            .file(.init(
                mediaType: attachment.mediaType,
                filename: attachment.filename,
                url: attachment.contentUrl,
                width: attachment.width,
                height: attachment.height
            ))
        })
        return parts
    }

    private func imageFileURLs(in message: SessionMessage) -> [String] {
        message.parts.compactMap { part in
            guard case .file(let file) = part,
                  file.mediaType.hasPrefix("image/") else {
                return nil
            }
            return file.url
        }
    }

    private func restoreLastSubmittedAttachments() {
        guard let clientMessageId = messages.first(where: \.isOptimisticUserMessage)?.id,
              let submittedAttachments = submittedAttachmentDrafts.removeValue(
                forKey: clientMessageId
              ) else {
            return
        }
        attachmentStore.restore(submittedAttachments)
    }
}

private extension AgentSessionViewModel {
    func loadCachedMessages() async {
        do {
            let cachedMessages = try await sessionMessageStore.messages(sessionId: session.id)
            guard !Task.isCancelled, !cachedMessages.isEmpty, messages.isEmpty, !hasLoadedMessages else {
                return
            }

            textRenderCache.reset()
            assistantDisplayDataByMessageId = assistantDisplayData(for: cachedMessages)
            messages = cachedMessages
            hasLoadedMessages = true
        } catch {
            Logger.warning("Failed to load cached session messages:", error)
        }
    }

    func replaceStreamAccumulator() {
        let previousAccumulator = streamAccumulator
        Task {
            await previousAccumulator?.finish()
        }
        messageThrottler?.cancel()
        streamGeneration += 1
        let generation = streamGeneration

        messageThrottler = SchedulerLatestValueThrottler(
            interval: .milliseconds(200),
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
