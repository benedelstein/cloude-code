import CoreAPI
import Foundation

// MARK: - Requests

private struct ListSessions: APIRequest {
    typealias Response = ListSessionsResponse

    var repoId: Int?
    var repoCursor: String?
    var sessionCursor: String?
    var repoLimit: Int?
    var sessionLimit: Int?

    var path: String { "sessions" }
    var method: HTTPMethod { .get }
    var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        if let repoId {
            items.append(URLQueryItem(name: "repoId", value: String(repoId)))
        }
        if let repoCursor {
            items.append(URLQueryItem(name: "repoCursor", value: repoCursor))
        }
        if let sessionCursor {
            items.append(URLQueryItem(name: "sessionCursor", value: sessionCursor))
        }
        if let repoLimit {
            items.append(URLQueryItem(name: "repoLimit", value: String(repoLimit)))
        }
        if let sessionLimit {
            items.append(URLQueryItem(name: "sessionLimit", value: String(sessionLimit)))
        }
        return items
    }
}

private struct CreateSession: APIRequest {
    typealias Body = CreateSessionRequest
    typealias Response = CreateSessionResponse

    var body: CreateSessionRequest?

    var path: String { "sessions" }
    var method: HTTPMethod { .post }
}

private struct GetSession: APIRequest {
    typealias Response = SessionInfoResponse

    var sessionId: UUID

    var path: String { "sessions/\(sessionId.uuidString.lowercased())" }
    var method: HTTPMethod { .get }
}

private struct GetSessionMessages: APIRequest {
    typealias Response = [UIMessage]

    var sessionId: UUID

    var path: String { "sessions/\(sessionId.uuidString.lowercased())/messages" }
    var method: HTTPMethod { .get }
}

private struct GetSessionPlan: APIRequest {
    typealias Response = SessionPlanResponse

    var sessionId: UUID

    var path: String { "sessions/\(sessionId.uuidString.lowercased())/plan" }
    var method: HTTPMethod { .get }
}

private struct UpdateSessionTitle: APIRequest {
    typealias Body = UpdateSessionTitleRequest
    typealias Response = UpdateSessionTitleResponse

    var sessionId: UUID
    var body: UpdateSessionTitleRequest?

    var path: String { "sessions/\(sessionId.uuidString.lowercased())/title" }
    var method: HTTPMethod { .patch }
}

private struct CreateSessionPullRequest: APIRequest {
    typealias Response = PullRequestResponse

    var sessionId: UUID

    var path: String { "sessions/\(sessionId.uuidString.lowercased())/pr" }
    var method: HTTPMethod { .post }
}

private struct GetSessionPullRequest: APIRequest {
    typealias Response = PullRequestStatusResponse

    var sessionId: UUID

    var path: String { "sessions/\(sessionId.uuidString.lowercased())/pr" }
    var method: HTTPMethod { .get }
}

private struct ArchiveSession: APIRequest {
    typealias Response = ArchiveSessionResponse

    var sessionId: UUID

    var path: String { "sessions/\(sessionId.uuidString.lowercased())/archive" }
    var method: HTTPMethod { .post }
}

private struct DeleteSession: APIRequest {
    typealias Response = DeleteSessionResponse

    var sessionId: UUID

    var path: String { "sessions/\(sessionId.uuidString.lowercased())" }
    var method: HTTPMethod { .delete }
}

private struct CreateSessionWebSocketToken: APIRequest {
    typealias Response = SessionWebSocketTokenResponse

    var sessionId: UUID

    var path: String { "sessions/\(sessionId.uuidString.lowercased())/websocket-token" }
    var method: HTTPMethod { .post }
}

private struct CreateUserSessionsWebSocketToken: APIRequest {
    typealias Response = UserSessionsWebSocketTokenResponse

    var path: String { "sessions/updates/token" }
    var method: HTTPMethod { .post }
}

// MARK: - API

/// Session HTTP API (`/sessions/*`). WebSocket upgrade tokens are minted here;
/// the live streams themselves are `SessionSocket` and `UserSessionsSocket`.
public protocol SessionsAPIProviding: Sendable {
    func listSessions(
        repoId: Int?,
        repoCursor: String?,
        sessionCursor: String?,
        repoLimit: Int?,
        sessionLimit: Int?
    ) async throws -> ListSessionsResponse
    func createSession(_ request: CreateSessionRequest) async throws -> CreateSessionResponse
    func session(id: UUID) async throws -> SessionInfoResponse
    func messages(sessionId: UUID) async throws -> [UIMessage]
    func plan(sessionId: UUID) async throws -> SessionPlanResponse
    func updateTitle(sessionId: UUID, title: String) async throws -> UpdateSessionTitleResponse
    func createPullRequest(sessionId: UUID) async throws -> PullRequestResponse
    func pullRequest(sessionId: UUID) async throws -> PullRequestStatusResponse
    func archive(sessionId: UUID) async throws
    func delete(sessionId: UUID) async throws
    func sessionWebSocketToken(sessionId: UUID) async throws -> WebSocketToken
    func userSessionsWebSocketToken() async throws -> WebSocketToken
}

public extension SessionsAPIProviding {
    func listSessions() async throws -> ListSessionsResponse {
        try await listSessions(
            repoId: nil,
            repoCursor: nil,
            sessionCursor: nil,
            repoLimit: nil,
            sessionLimit: nil
        )
    }
}

public struct SessionsAPI: SessionsAPIProviding {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func listSessions(
        repoId: Int?,
        repoCursor: String?,
        sessionCursor: String?,
        repoLimit: Int?,
        sessionLimit: Int?
    ) async throws -> ListSessionsResponse {
        try await client.fetch(ListSessions(
            repoId: repoId,
            repoCursor: repoCursor,
            sessionCursor: sessionCursor,
            repoLimit: repoLimit,
            sessionLimit: sessionLimit
        ))
    }

    public func createSession(_ request: CreateSessionRequest) async throws -> CreateSessionResponse {
        try await client.fetch(CreateSession(body: request))
    }

    public func session(id: UUID) async throws -> SessionInfoResponse {
        try await client.fetch(GetSession(sessionId: id))
    }

    public func messages(sessionId: UUID) async throws -> [UIMessage] {
        try await client.fetch(GetSessionMessages(sessionId: sessionId))
    }

    public func plan(sessionId: UUID) async throws -> SessionPlanResponse {
        try await client.fetch(GetSessionPlan(sessionId: sessionId))
    }

    public func updateTitle(sessionId: UUID, title: String) async throws -> UpdateSessionTitleResponse {
        try await client.fetch(UpdateSessionTitle(
            sessionId: sessionId,
            body: UpdateSessionTitleRequest(title: title)
        ))
    }

    public func createPullRequest(sessionId: UUID) async throws -> PullRequestResponse {
        try await client.fetch(CreateSessionPullRequest(sessionId: sessionId))
    }

    public func pullRequest(sessionId: UUID) async throws -> PullRequestStatusResponse {
        try await client.fetch(GetSessionPullRequest(sessionId: sessionId))
    }

    public func archive(sessionId: UUID) async throws {
        _ = try await client.fetch(ArchiveSession(sessionId: sessionId))
    }

    public func delete(sessionId: UUID) async throws {
        _ = try await client.fetch(DeleteSession(sessionId: sessionId))
    }

    public func sessionWebSocketToken(sessionId: UUID) async throws -> WebSocketToken {
        let response = try await client.fetch(CreateSessionWebSocketToken(sessionId: sessionId))
        return WebSocketToken(token: response.token, expiresAt: response.expiresAt)
    }

    public func userSessionsWebSocketToken() async throws -> WebSocketToken {
        let response = try await client.fetch(CreateUserSessionsWebSocketToken())
        return WebSocketToken(token: response.token, expiresAt: response.expiresAt)
    }
}
