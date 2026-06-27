import CoreAPI
import Domain
import Foundation

/// Events emitted by `UserSessionsSocket`.
public enum UserSessionsSocketEvent: Sendable {
    case connectionChanged(WebSocketConnectionState)
    case server(UserSessionsServerEvent)
}

/// Server-push messages, already mapped to domain values. Wire types
/// (`CoreAPI.UserSessionsServerMessage`) stay inside this module.
public enum UserSessionsServerEvent: Sendable {
    case connected
    case summaryCreated(Domain.SessionSummary)
    case summaryUpdated(Domain.SessionSummary)
    case summaryRemoved(id: String)
    case resyncRequired

    init?(_ message: UserSessionsServerMessage) {
        switch message {
        case .userSessionsConnected:
            self = .connected
        case .sessionSummaryCreated(let event):
            self = .summaryCreated(event.session.domainSummary)
        case .sessionSummaryUpdated(let event):
            self = .summaryUpdated(event.session.domainSummary)
        case .sessionSummaryRemoved(let event):
            self = .summaryRemoved(id: event.sessionId)
        case .sessionListResyncRequired:
            self = .resyncRequired
        case .unknown(let type):
            Logger.debug("Ignoring unknown user-sessions message type:", type)
            return nil
        }
    }
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
        tokenCache: WebSocketTokenCache
    ) {
        connection = WebSocketConnection {
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
                let message = try JSONDecoder().decode(UserSessionsServerMessage.self, from: data)
                return UserSessionsServerEvent(message).map { .server($0) }
            } catch {
                Logger.warning("Dropping undecodable user-sessions frame:", error)
                return nil
            }
        }
    }
}
