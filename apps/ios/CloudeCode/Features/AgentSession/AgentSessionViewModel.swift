import API
import Combine
import CoreAPI
import Domain
import Entities
import Foundation
import SwiftUI

/// Coordinates session state, transcript rendering, composer drafts, and socket events.
///
/// Behavior is split across `AgentSessionViewModel+*.swift` extension files
/// (model selection, attachments, sending, socket lifecycle, transcript), so
/// most stored state is internal rather than private.
@MainActor
@Observable
final class AgentSessionViewModel {
    typealias MessageDisplayData = AgentSessionView.MessageDisplayData
    typealias TranscriptRow = AgentSessionView.TranscriptRow

    var context: Context
    let modelCatalogStore: ModelCatalogStore
    let preferences: NewSessionPreferences
    var socket: SessionSocket?
    let makeSocket: (String) -> SessionSocket
    /// Fires the created session id when a draft turns into a real session;
    /// `HomeRouter` listens to the derived publisher to adopt the draft route.
    let sessionCreatedSubject: PassthroughSubject<String, Never>
    let sessionMessageStore: SessionMessageStore
    let sessionSummaryStore: SessionSummaryStore
    let transcriptBuilder: any AgentSessionTranscriptBuilding
    var subscriptionTask: Task<Void, Never>?
    /// The user's explicit pick: the whole selection for a draft (no client
    /// state exists yet), or a staged next-turn override for an existing
    /// session that is cleared once live client state reports it as current.
    var localModelSelection: ModelSelection?
    private var hasSeenServerActiveTurn = false
    private var lastMarkReadSentMessageId: String?
    // Keeps the local upload drafts for an optimistic message so they can be
    // restored if send fails after the composer has already been cleared.
    @ObservationIgnored var submittedAttachmentDrafts: [String: [ImageAttachmentDraft]] = [:]

    let attachmentStore: ImageAttachmentStore
    var connectionState: WebSocketConnectionState = .disconnected
    /// Ordered transcript rows. A row's `id` is stable for its lifetime; its
    /// `messageID` is reassigned in place when a message gains its server id
    /// (optimistic -> accepted, streaming -> final).
    var transcriptRows: [TranscriptRow] = []
    /// Message content keyed by message id. `transcriptRows` owns ordering;
    /// every row's `messageID` resolves here.
    var messagesByID: [String: SessionMessage] = [:]
    /// Hydrated, normalized display data per transcript row.
    var assistantDisplayDataByRowID: [String: MessageDisplayData] = [:]
    // The active streaming row keeps this id from first chunk through final
    // message so collection view can update the existing cell in place.
    var streamingTranscriptRowID: String?
    @ObservationIgnored var messageThrottler: SchedulerLatestValueThrottler<SessionMessage>?
    @ObservationIgnored let textRenderCache = ChunkedTextRenderCache()
    var streamAccumulator: SessionMessageStreamAccumulator?
    /// Guard so that we do not accumulate to a stream that is no longer active
    var streamGeneration = 0
    var streamStatus = SessionMessageStreamStatus()
    // Future optimization: cache a curated subset of client state
    // if needed. Do not persist raw SessionClientState; active turns,
    // pending work, editor readiness, and transient errors are live state.
    private(set) var clientState = SessionClientState.empty
    /// Message send is in progress
    var isSending = false
    /// The initial request is creating a new session.
    var isCreatingSession = false
    /// Waiting for a message stream response from server.
    /// Set to true after we send a message
    var isWaitingForResponse = false
    var hasLoadedMessages: Bool = false
    var draftText = ""
    var errorMessage: String?

    var canSubmitDraft: Bool {
        let hasContent = !draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !attachmentStore.attachments.isEmpty
        let canSendInCurrentMode = isDraftMode
            ? draft?.selectedRepo != nil && isModelSelectionValid
            : connectionState == .connected
        return hasContent
            && !attachmentStore.hasPendingOrFailedUploads
            && canSendInCurrentMode
            && !isSending
            && !isResponding
    }

    var isResponding: Bool {
        isWaitingForResponse
            || streamStatus.isActive
            || clientState.activeTurnUserMessageId != nil
    }

    init(
        context: Context,
        modelCatalogStore: ModelCatalogStore,
        preferences: NewSessionPreferences,
        makeSocket: @escaping (String) -> SessionSocket,
        sessionMessageStore: SessionMessageStore,
        sessionSummaryStore: SessionSummaryStore,
        transcriptBuilder: any AgentSessionTranscriptBuilding,
        attachmentsAPI: any AttachmentsAPIProviding,
        sessionCreatedSubject: PassthroughSubject<String, Never>
    ) {
        self.context = context
        self.sessionCreatedSubject = sessionCreatedSubject
        self.modelCatalogStore = modelCatalogStore
        self.preferences = preferences
        if context.draft != nil {
            localModelSelection = ModelSelection(preference: preferences.lastSelectedModel)
        }
        self.socket = context.session.map { makeSocket($0.id) }
        self.makeSocket = makeSocket
        self.sessionMessageStore = sessionMessageStore
        self.sessionSummaryStore = sessionSummaryStore
        self.transcriptBuilder = transcriptBuilder
        attachmentStore = ImageAttachmentStore(
            sessionId: context.session?.id,
            attachmentsAPI: attachmentsAPI
        )
    }

    // swiftlint:disable:next cyclomatic_complexity
    func handle(_ event: SessionSocketEvent) async {
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

    func applyLiveState(_ state: SessionClientState) {
        let previousProvider = clientState.agentSettings.provider
        clientState = state
        // A non-matching override persists until the server confirms it: live
        // state may still reflect the previous turn's settings.
        if localModelSelection?.matches(state.agentSettings) == true {
            localModelSelection = nil
        }
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
        rebuildTranscript(from: snapshotMessages)
        replaceStreamAccumulator()
        if snapshot.pendingChunks.isEmpty {
            clearStreamingState(removeActiveTranscript: true)
        } else {
            await streamAccumulator?.append(
                snapshot.pendingChunks,
                messageMetadata: snapshot.pendingMessageMetadata
            )
        }
        applyActiveTurnUserMessageId(snapshot.activeTurnUserMessageId)
        markLatestAssistantMessageRead(in: snapshotMessages)
        if let session {
            do {
                try await sessionMessageStore.replace(
                    sessionId: session.id,
                    with: snapshot.messages
                )
            } catch {
                Logger.warning("Failed to replace session message cache:", error)
            }
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

    private func markLatestAssistantMessageRead(in messages: [SessionMessage]) {
        guard let messageId = messages.reversed().first(where: { $0.role == .assistant })?.id else {
            return
        }
        markReadIfNeeded(messageId: messageId)
    }

    func markReadIfNeeded(messageId: String) {
        guard lastMarkReadSentMessageId != messageId else {
            return
        }
        guard let socket else {
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
        guard let session, session.lastAssistantMessageId == messageId else {
            return
        }
        session.hasUnread = false
        sessionSummaryStore.save([session])
    }

    func resetPendingResponse() {
        let streamAccumulator = self.streamAccumulator
        Task {
            await streamAccumulator?.finish()
        }
        self.streamAccumulator = nil
        messageThrottler?.cancel()
        messageThrottler = nil
        streamGeneration += 1
        clearStreamingState(removeActiveTranscript: true)
        clientState.activeTurnUserMessageId = nil
        isSending = false
        isCreatingSession = false
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
    var isConnected: Bool {
        connectionState == .connected
    }

    var composerPlaceholder: String {
        if isCreatingSession {
            return "Creating session..."
        }
        if isDraftMode {
            return "Send a message..."
        }
        return switch connectionState {
        case .connecting:
            "Connecting..."
        case .connected:
            isResponding ? "Agent is responding..." : "Send a message..."
        case .disconnected:
            "Reconnecting..."
        }
    }

    enum Context {
        case session(SessionSummaryModel)
        case draft(NewSessionDraft)

        var session: SessionSummaryModel? {
            guard case .session(let session) = self else {
                return nil
            }
            return session
        }

        var draft: NewSessionDraft? {
            guard case .draft(let draft) = self else {
                return nil
            }
            return draft
        }
    }

    /// Canonical cached model; cache and socket updates propagate through this reference.
    var session: SessionSummaryModel? {
        context.session
    }

    var draft: NewSessionDraft? {
        context.draft
    }

    var isDraftMode: Bool {
        if case .draft = context {
            return true
        }
        return false
    }
}
