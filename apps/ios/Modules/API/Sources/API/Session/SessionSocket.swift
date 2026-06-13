import CoreAPI
import Domain
import Foundation

/// Events emitted by `SessionSocket`.
public enum SessionSocketEvent: Sendable {
    case connectionChanged(WebSocketConnectionState)
    case connected(status: String)
    case syncResponse(SessionSyncSnapshot)
    case operationError(SessionSocketOperationError)
    case agentChunks([AgentStreamChunk])
    case agentFinish(AgentUIMessage)
    case agentReady
    case userMessage(AgentUIMessage)
    case editorReady(url: String)
    case liveState(SessionSocketLiveState)
}

/// Typed client for the session WebSocket at `/agents/session/{sessionId}`.
///
/// The endpoint is a Cloudflare Agents SDK agent, so two frame families
/// interleave on the wire: this service's `ServerMessage` JSON broadcasts and
/// the SDK's own `cf_agent_*` control frames — of which only `cf_agent_state`
/// (full `ClientState` snapshots) is meaningful to us; the rest are dropped.
/// Reconnection and token refresh are owned by the underlying
/// `WebSocketConnection`. The server sends `connected` and `sync.response` on
/// each connection; `sync.request` is reserved for explicit recovery flows.
/// `events` is single-consumer.
public actor SessionSocket {
    public nonisolated let events: AsyncStream<SessionSocketEvent>

    private let connection: WebSocketConnection
    private let continuation: AsyncStream<SessionSocketEvent>.Continuation
    private var pumpTask: Task<Void, Never>?

    public init(
        baseURL: URL,
        sessionId: UUID,
        urlSession: URLSession = .shared,
        tokenCache: WebSocketTokenCache
    ) {
        let path = "agents/session/\(sessionId.uuidString.lowercased())"
        connection = WebSocketConnection(urlSession: urlSession) {
            let token = try await tokenCache.token()
            return try WebSocketURLBuilder.url(baseURL: baseURL, path: path, token: token.token)
        }
        (events, continuation) = AsyncStream.makeStream()
    }

    public func connect() async {
        guard pumpTask == nil else { return }
        pumpTask = Task { [connection, continuation] in
            for await event in connection.events {
                if let decoded = Self.decode(event) {
                    continuation.yield(decoded)
                }
            }
            continuation.finish()
        }
        await connection.connect()
    }

    public func disconnect() async {
        await connection.disconnect()
        pumpTask?.cancel()
        pumpTask = nil
    }

    public func requestSync(lastMessageId: UUID? = nil, lastChunkIndex: Int? = nil) async throws {
        try await send(.syncRequest(SyncRequestEvent(
            lastMessageId: lastMessageId,
            lastChunkIndex: lastChunkIndex
        )))
    }

    public func sendChat(content: String) async throws {
        try await send(.chatMessage(ChatMessageEvent(content: content)))
    }

    public func markRead(messageId: String) async throws {
        try await send(.sessionMarkRead(SessionMarkReadEvent(messageId: messageId)))
    }

    private func send(_ message: ClientMessage) async throws {
        let data = try JSONEncoder().encode(message)
        guard let text = String(data: data, encoding: .utf8) else {
            throw APIError.webSocketNotConnected
        }
        try await connection.send(text: text)
    }

    private static func decode(_ event: WebSocketTransportEvent) -> SessionSocketEvent? {
        switch event {
        case .stateChanged(let state):
            return .connectionChanged(state)
        case .message(let data):
            return decodeFrame(data)
        }
    }

    private static func decodeFrame(_ data: Data) -> SessionSocketEvent? {
        struct TypeProbe: Decodable {
            let type: String
        }
        struct AgentStateFrame: Decodable {
            let state: ClientState
        }

        do {
            let decoder = JSONDecoder()
            let probe = try decoder.decode(TypeProbe.self, from: data)
            if probe.type == "cf_agent_state" {
                let frame = try decoder.decode(AgentStateFrame.self, from: data)
                return .liveState(SessionSocketLiveState(frame.state))
            }
            if probe.type.hasPrefix("cf_") {
                // Other Agents SDK control frames (identity, RPC, …) are unused.
                return nil
            }
            return event(from: try decoder.decode(ServerMessage.self, from: data))
        } catch {
            Logger.warning("Dropping undecodable session frame:", error)
            return nil
        }
    }

    private static func event(from message: ServerMessage) -> SessionSocketEvent? {
        switch message {
        case .agentReady:
            return .agentReady
        case .setupOutputChunks, .unknown:
            return nil
        case .connected, .operationError, .editorReady:
            return lifecycleEvent(from: message)
        case .syncResponse, .agentChunks, .agentFinish, .userMessage:
            return transcriptEvent(from: message)
        }
    }

    private static func lifecycleEvent(from message: ServerMessage) -> SessionSocketEvent? {
        switch message {
        case .connected(let event):
            return .connected(status: event.status.rawValue)
        case .operationError(let event):
            return .operationError(SessionSocketOperationError(
                code: event.code.rawValue,
                message: event.message
            ))
        case .editorReady(let event):
            return .editorReady(url: event.url)
        case .syncResponse, .agentChunks, .agentFinish, .agentReady, .userMessage, .setupOutputChunks, .unknown:
            return nil
        }
    }

    private static func transcriptEvent(from message: ServerMessage) -> SessionSocketEvent? {
        switch message {
        case .syncResponse(let event):
            return .syncResponse(SessionSyncSnapshot(
                messages: event.messages.map(AgentUIMessage.init),
                pendingChunks: (event.pendingChunks ?? []).map(AgentStreamChunk.init),
                activeTurnUserMessageId: event.activeTurn?.userMessageId
            ))
        case .agentChunks(let event):
            return .agentChunks(event.chunks.map(AgentStreamChunk.init))
        case .agentFinish(let event):
            return .agentFinish(AgentUIMessage(event.message))
        case .userMessage(let event):
            return .userMessage(AgentUIMessage(event.message))
        case .connected, .operationError, .agentReady, .editorReady, .setupOutputChunks, .unknown:
            return nil
        }
    }
}
