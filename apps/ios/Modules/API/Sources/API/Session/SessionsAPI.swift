import CoreAPI
import Domain
import Foundation

// MARK: - Requests

private struct ListSessions: APIRequest {
    typealias Response = ListSessionsResponse

    var repoId: Int?
    var repoCursor: String?
    var sessionCursor: String?
    var repoLimit: Int?
    var sessionLimit: Int?

    var headers: [String: String]

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

    var headers: [String: String]

    var path: String { "sessions" }
    var method: HTTPMethod { .post }
}

private struct GetSession: APIRequest {
    typealias Response = SessionInfoResponse

    var sessionId: String

    var headers: [String: String]

    var path: String { "sessions/\(sessionId)" }
    var method: HTTPMethod { .get }
}

private struct GetSessionMessages: APIRequest {
    typealias Response = [WireUIMessage]

    var sessionId: String

    var headers: [String: String]

    var path: String { "sessions/\(sessionId)/messages" }
    var method: HTTPMethod { .get }
}

private struct GetSessionPlan: APIRequest {
    typealias Response = SessionPlanResponse

    var sessionId: String

    var headers: [String: String]

    var path: String { "sessions/\(sessionId)/plan" }
    var method: HTTPMethod { .get }
}

private struct UpdateSessionTitle: APIRequest {
    typealias Body = UpdateSessionTitleRequest
    typealias Response = UpdateSessionTitleResponse

    var sessionId: String
    var body: UpdateSessionTitleRequest?

    var headers: [String: String]

    var path: String { "sessions/\(sessionId)/title" }
    var method: HTTPMethod { .patch }
}

private struct CreateSessionPullRequest: APIRequest {
    typealias Response = PullRequestResponse

    var sessionId: String

    var headers: [String: String]

    var path: String { "sessions/\(sessionId)/pr" }
    var method: HTTPMethod { .post }
}

private struct GetSessionPullRequest: APIRequest {
    typealias Response = PullRequestStatusResponse

    var sessionId: String

    var headers: [String: String]

    var path: String { "sessions/\(sessionId)/pr" }
    var method: HTTPMethod { .get }
}

private struct ArchiveSession: APIRequest {
    typealias Response = ArchiveSessionResponse

    var sessionId: String

    var headers: [String: String]

    var path: String { "sessions/\(sessionId)/archive" }
    var method: HTTPMethod { .post }
}

private struct DeleteSession: APIRequest {
    typealias Response = DeleteSessionResponse

    var sessionId: String

    var headers: [String: String]

    var path: String { "sessions/\(sessionId)" }
    var method: HTTPMethod { .delete }
}

private struct CreateSessionWebSocketToken: APIRequest {
    typealias Response = SessionWebSocketTokenResponse

    var sessionId: String

    var headers: [String: String]

    var path: String { "sessions/\(sessionId)/websocket-token" }
    var method: HTTPMethod { .post }
}

private struct CreateUserSessionsWebSocketToken: APIRequest {
    typealias Response = UserSessionsWebSocketTokenResponse

    var headers: [String: String]

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
    ) async throws -> SessionSummaryPage
    func createSession(_ request: CreateSessionRequest) async throws -> CreateSessionResponse
    func session(id: String) async throws -> SessionInfoResponse
    func messages(sessionId: String) async throws -> [SessionMessage]
    func plan(sessionId: String) async throws -> SessionPlanResponse
    func updateTitle(sessionId: String, title: String) async throws -> UpdateSessionTitleResponse
    func createPullRequest(sessionId: String) async throws -> PullRequestResponse
    func pullRequest(sessionId: String) async throws -> PullRequestStatusResponse
    func archive(sessionId: String) async throws
    func delete(sessionId: String) async throws
    func sessionWebSocketToken(sessionId: String) async throws -> WebSocketToken
    func userSessionsWebSocketToken() async throws -> WebSocketToken
}

public extension SessionsAPIProviding {
    func listSessions() async throws -> SessionSummaryPage {
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
    private let tokenProvider: any AuthTokenProviding

    public init(client: APIClient, tokenProvider: any AuthTokenProviding) {
        self.client = client
        self.tokenProvider = tokenProvider
    }

    public func listSessions(
        repoId: Int?,
        repoCursor: String?,
        sessionCursor: String?,
        repoLimit: Int?,
        sessionLimit: Int?
    ) async throws -> SessionSummaryPage {
        try await client.fetch(ListSessions(
            repoId: repoId,
            repoCursor: repoCursor,
            sessionCursor: sessionCursor,
            repoLimit: repoLimit,
            sessionLimit: sessionLimit,
            headers: tokenProvider.bearerHeaders()
        )).summaryPage
    }

    public func createSession(_ request: CreateSessionRequest) async throws -> CreateSessionResponse {
        try await client.fetch(CreateSession(body: request, headers: tokenProvider.bearerHeaders()))
    }

    public func session(id: String) async throws -> SessionInfoResponse {
        try await client.fetch(GetSession(sessionId: id, headers: tokenProvider.bearerHeaders()))
    }

    public func messages(sessionId: String) async throws -> [SessionMessage] {
        try await client.fetch(GetSessionMessages(
            sessionId: sessionId,
            headers: tokenProvider.bearerHeaders()
        )).map(SessionMessage.init)
    }

    public func plan(sessionId: String) async throws -> SessionPlanResponse {
        try await client.fetch(GetSessionPlan(sessionId: sessionId, headers: tokenProvider.bearerHeaders()))
    }

    public func updateTitle(sessionId: String, title: String) async throws -> UpdateSessionTitleResponse {
        try await client.fetch(UpdateSessionTitle(
            sessionId: sessionId,
            body: UpdateSessionTitleRequest(title: title),
            headers: tokenProvider.bearerHeaders()
        ))
    }

    public func createPullRequest(sessionId: String) async throws -> PullRequestResponse {
        try await client.fetch(CreateSessionPullRequest(sessionId: sessionId, headers: tokenProvider.bearerHeaders()))
    }

    public func pullRequest(sessionId: String) async throws -> PullRequestStatusResponse {
        try await client.fetch(GetSessionPullRequest(sessionId: sessionId, headers: tokenProvider.bearerHeaders()))
    }

    public func archive(sessionId: String) async throws {
        _ = try await client.fetch(ArchiveSession(sessionId: sessionId, headers: tokenProvider.bearerHeaders()))
    }

    public func delete(sessionId: String) async throws {
        _ = try await client.fetch(DeleteSession(sessionId: sessionId, headers: tokenProvider.bearerHeaders()))
    }

    public func sessionWebSocketToken(sessionId: String) async throws -> WebSocketToken {
        let response = try await client.fetch(CreateSessionWebSocketToken(
            sessionId: sessionId,
            headers: tokenProvider.bearerHeaders()
        ))
        return WebSocketToken(token: response.token, expiresAt: response.expiresAt)
    }

    public func userSessionsWebSocketToken() async throws -> WebSocketToken {
        let response = try await client.fetch(CreateUserSessionsWebSocketToken(headers: tokenProvider.bearerHeaders()))
        return WebSocketToken(token: response.token, expiresAt: response.expiresAt)
    }
}
