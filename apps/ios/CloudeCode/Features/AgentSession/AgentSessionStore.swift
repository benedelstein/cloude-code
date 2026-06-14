import API
import Domain
import Entities
import Foundation

@MainActor
@Observable
final class AgentSessionStore {
    /// Canonical cached model — updates from the cache/socket propagate here.
    let session: SessionSummaryModel

    private let socket: SessionSocket
    private var subscriptionTask: Task<Void, Never>?
    private var hasSeenServerActiveTurn = false

    private(set) var connectionState: WebSocketConnectionState = .disconnected
    private(set) var messages: [SessionMessage] = []
    private(set) var stream = SessionMessageStreamState()
    private(set) var clientState = SessionClientState.empty
    private(set) var isSending = false
    private(set) var isWaitingForResponse = false
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

    init(session: SessionSummaryModel, socket: SessionSocket) {
        self.session = session
        self.socket = socket
    }

    func bind() {
        guard subscriptionTask == nil else {
            return
        }

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
        isSending = true
        isWaitingForResponse = true
        errorMessage = nil

        Task { [weak self, socket] in
            do {
                try await socket.sendChat(content: content)
                self?.finishSending()
            } catch {
                self?.record(error)
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
            resetPendingResponse()
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
            clientState = state
            applyActiveTurnUserMessageId(state.activeTurnUserMessageId)
        case .connectionChanged, .syncResponse, .operationError, .agentChunks, .agentFinish, .agentReady, .userMessage:
            break
        }
    }

    private func applyTranscriptEvent(_ event: SessionSocketEvent) async {
        switch event {
        case .syncResponse(let snapshot):
            messages = snapshot.messages
            stream = await SessionMessageStreamState.reducing(snapshot.pendingChunks)
            applyActiveTurnUserMessageId(snapshot.activeTurnUserMessageId)
        case .agentChunks(let chunks):
            stream = await stream.appending(chunks)
        case .agentFinish(let message):
            upsert(message)
            resetPendingResponse()
        case .userMessage(let message):
            upsert(message)
            isSending = false
            errorMessage = nil
        case .connectionChanged, .connected, .operationError, .agentReady, .editorReady, .liveState:
            break
        }
    }

    private func upsert(_ message: SessionMessage) {
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            messages[index] = message
        } else {
            messages.append(message)
        }
    }

    private func finishSending() {
        isSending = false
    }

    private func record(_ error: any Error) {
        errorMessage = error.localizedDescription
        resetPendingResponse()
    }

    private func resetPendingResponse() {
        stream = SessionMessageStreamState()
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
        }
    }
}
