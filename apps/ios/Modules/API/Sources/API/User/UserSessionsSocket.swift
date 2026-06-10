import CoreAPI
import Domain
import Foundation

/// Events emitted by `UserSessionsSocket`.
public enum UserSessionsSocketEvent: Sendable {
    case connectionChanged(WebSocketConnectionState)
    case server(UserSessionsServerMessage)
}

/// Typed client for the user-level sessions WebSocket at `/sessions/updates`.
///
/// Server-push only (session summary created/updated/removed for the
/// sidebar); there are no client messages. Events can be missed while
/// disconnected, so callers should refetch the session list whenever the
/// connection transitions back to `.connected` or a
/// `session.list.resync_required` message arrives. `events` is
/// single-consumer.
public actor UserSessionsSocket {
    public nonisolated let events: AsyncStream<UserSessionsSocketEvent>

    private let connection: WebSocketConnection
    private let continuation: AsyncStream<UserSessionsSocketEvent>.Continuation
    private var pumpTask: Task<Void, Never>?

    public init(
        baseURL: URL,
        urlSession: URLSession = .shared,
        tokenCache: WebSocketTokenCache
    ) {
        connection = WebSocketConnection(urlSession: urlSession) {
            let token = try await tokenCache.token()
            return try WebSocketURLBuilder.url(baseURL: baseURL, path: "sessions/updates", token: token.token)
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

    private static func decode(_ event: WebSocketTransportEvent) -> UserSessionsSocketEvent? {
        switch event {
        case .stateChanged(let state):
            return .connectionChanged(state)
        case .message(let data):
            do {
                return .server(try JSONDecoder().decode(UserSessionsServerMessage.self, from: data))
            } catch {
                Logger.warning("Dropping undecodable user-sessions frame:", error)
                return nil
            }
        }
    }
}
