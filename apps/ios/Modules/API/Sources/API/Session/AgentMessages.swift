import CoreAPI

/// Session transcript message summary exposed to app features.
public struct AgentUIMessage: Sendable, Equatable, Identifiable {
    public let id: String
    public let role: String

    let wireMessage: CoreAPI.UIMessage

    init(_ message: CoreAPI.UIMessage) {
        id = message.id
        role = message.role.rawValue
        wireMessage = message
    }
}

/// Opaque AI SDK stream chunks from the session WebSocket.
public struct AgentStreamChunk: Sendable, Equatable {
    let value: CoreAPI.JSONValue

    init(_ value: CoreAPI.JSONValue) {
        self.value = value
    }
}

public struct SessionSyncSnapshot: Sendable, Equatable {
    public let messages: [AgentUIMessage]
    public let pendingChunks: [AgentStreamChunk]
    public let activeTurnUserMessageId: String?

    public init(
        messages: [AgentUIMessage],
        pendingChunks: [AgentStreamChunk],
        activeTurnUserMessageId: String?
    ) {
        self.messages = messages
        self.pendingChunks = pendingChunks
        self.activeTurnUserMessageId = activeTurnUserMessageId
    }
}

public struct SessionSocketLiveState: Sendable, Equatable {
    public let repoFullName: String?
    public let status: String
    public let baseBranch: String?
    public let pushedBranch: String?
    public let activeTurnUserMessageId: String?
    public let editorURL: String?
    public let lastError: String?

    public init(
        repoFullName: String?,
        status: String,
        baseBranch: String?,
        pushedBranch: String?,
        activeTurnUserMessageId: String?,
        editorURL: String?,
        lastError: String?
    ) {
        self.repoFullName = repoFullName
        self.status = status
        self.baseBranch = baseBranch
        self.pushedBranch = pushedBranch
        self.activeTurnUserMessageId = activeTurnUserMessageId
        self.editorURL = editorURL
        self.lastError = lastError
    }

    init(_ state: ClientState) {
        self.init(
            repoFullName: state.repoFullName,
            status: state.status.rawValue,
            baseBranch: state.baseBranch,
            pushedBranch: state.pushedBranch,
            activeTurnUserMessageId: state.activeTurn?.userMessageId,
            editorURL: state.editorUrl,
            lastError: state.lastError
        )
    }
}

public struct SessionSocketOperationError: Sendable, Equatable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}
