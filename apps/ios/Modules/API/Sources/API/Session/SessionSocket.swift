import CoreAPI
import Domain
import Foundation

/// Events emitted by `SessionSocket`.
public enum SessionSocketEvent: Sendable {
    case connectionChanged(WebSocketConnectionState)
    /// A protocol message broadcast by the session Durable Object.
    case server(ServerMessage)
    /// A `cf_agent_state` state-sync frame from the Cloudflare Agents SDK.
    case state(ClientState)
}

/// Typed client for the session WebSocket at `/agents/session/{sessionId}`.
///
/// The endpoint is a Cloudflare Agents SDK agent, so two frame families
/// interleave on the wire: this service's `ServerMessage` JSON broadcasts and
/// the SDK's own `cf_agent_*` control frames — of which only `cf_agent_state`
/// (full `ClientState` snapshots) is meaningful to us; the rest are dropped.
/// Reconnection and token refresh are owned by the underlying
/// `WebSocketConnection`; after a reconnect, callers should send a
/// `sync.request` to recover missed messages. `events` is single-consumer.
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

    public func send(_ message: ClientMessage) async throws {
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
                return .state(try decoder.decode(AgentStateFrame.self, from: data).state)
            }
            if probe.type.hasPrefix("cf_") {
                // Other Agents SDK control frames (identity, RPC, …) are unused.
                return nil
            }
            return .server(try decoder.decode(ServerMessage.self, from: data))
        } catch {
            Logger.warning("Dropping undecodable session frame:", error)
            return nil
        }
    }
}
