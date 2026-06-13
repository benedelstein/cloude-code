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

    private(set) var connectionState: WebSocketConnectionState = .disconnected
    private(set) var messages: [AgentSessionMessage] = []
    private(set) var stream = AgentSessionStreamState()
    private(set) var clientState = AgentSessionClientState()
    private(set) var transcriptRevision = 0
    private(set) var isSending = false
    var draftText = ""
    var errorMessage: String?

    var canSubmitDraft: Bool {
        !draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && connectionState == .connected
            && !isSending
    }

    var isConnected: Bool {
        connectionState == .connected
    }

    var composerPlaceholder: String {
        switch connectionState {
        case .connecting:
            "Connecting..."
        case .connected:
            "Send a message..."
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
        guard !content.isEmpty, !isSending else {
            return
        }

        draftText = ""
        isSending = true
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
        case .operationError(let operationError):
            errorMessage = operationError.message
            stream = AgentSessionStreamState()
            clientState.activeTurnUserMessageId = nil
            isSending = false
            markTranscriptChanged()
        case .agentReady:
            break
        case .connected, .editorReady, .liveState:
            applyLiveState(event)
        case .syncResponse, .agentChunks, .agentFinish, .userMessage:
            applyTranscriptEvent(event)
        }
    }

    private func applyLiveState(_ event: SessionSocketEvent) {
        switch event {
        case .connected(let status):
            clientState.status = status
        case .editorReady(let url):
            clientState.editorURL = url
        case .liveState(let state):
            clientState = AgentSessionClientState(state)
        case .connectionChanged, .syncResponse, .operationError, .agentChunks, .agentFinish, .agentReady, .userMessage:
            break
        }
    }

    private func applyTranscriptEvent(_ event: SessionSocketEvent) {
        switch event {
        case .syncResponse(let snapshot):
            messages = snapshot.messages.map(AgentSessionMessage.init)
            stream = AgentSessionStreamState(chunks: snapshot.pendingChunks)
            clientState.activeTurnUserMessageId = snapshot.activeTurnUserMessageId
            markTranscriptChanged()
        case .agentChunks(let chunks):
            stream.append(chunks)
            markTranscriptChanged()
        case .agentFinish(let message):
            upsert(message)
            stream = AgentSessionStreamState()
            clientState.activeTurnUserMessageId = nil
            isSending = false
            markTranscriptChanged()
        case .userMessage(let message):
            upsert(message)
            isSending = false
            errorMessage = nil
            markTranscriptChanged()
        case .connectionChanged, .connected, .operationError, .agentReady, .editorReady, .liveState:
            break
        }
    }

    private func upsert(_ message: AgentUIMessage) {
        let next = AgentSessionMessage(message)
        if let index = messages.firstIndex(where: { $0.id == next.id }) {
            messages[index] = next
        } else {
            messages.append(next)
        }
    }

    private func finishSending() {
        isSending = false
    }

    private func record(_ error: any Error) {
        errorMessage = error.localizedDescription
        isSending = false
    }

    private func markTranscriptChanged() {
        transcriptRevision += 1
    }
}

struct AgentSessionMessage: Identifiable, Equatable {
    let message: AgentUIMessage

    var id: String {
        message.id
    }

    var roleLabel: String {
        message.role
    }

    init(_ message: AgentUIMessage) {
        self.message = message
    }
}

struct AgentSessionStreamState: Equatable {
    private(set) var chunks: [AgentStreamChunk] = []

    var isActive: Bool {
        !chunks.isEmpty
    }

    var chunkCount: Int {
        chunks.count
    }

    mutating func append(_ newChunks: [AgentStreamChunk]) {
        chunks.append(contentsOf: newChunks)
    }
}

struct AgentSessionClientState: Equatable {
    var repoFullName: String?
    var status = "preparing"
    var baseBranch: String?
    var pushedBranch: String?
    var activeTurnUserMessageId: String?
    var editorURL: String?
    var lastError: String?

    init() {}

    init(_ state: SessionSocketLiveState) {
        repoFullName = state.repoFullName
        status = state.status
        baseBranch = state.baseBranch
        pushedBranch = state.pushedBranch
        activeTurnUserMessageId = state.activeTurnUserMessageId
        editorURL = state.editorURL
        lastError = state.lastError
    }
}
