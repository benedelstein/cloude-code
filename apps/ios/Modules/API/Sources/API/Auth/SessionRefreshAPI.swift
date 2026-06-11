import CoreAPI
import Domain
import Foundation

private struct PostRefresh: APIRequest {
    typealias Body = CoreAPI.RefreshRequest
    typealias Response = CoreAPI.RefreshResponse

    var body: CoreAPI.RefreshRequest?

    var path: String { "auth/refresh" }
    var method: HTTPMethod { .post }
    // No auth header: the refresh token in the body is the credential.
}

/// Rotates a session's token pair via `POST /auth/refresh`.
public protocol SessionRefreshing: Sendable {
    func refresh(refreshToken: String, userId: String) async throws -> Session
}

/// Provider-free by construction: refresh is the one auth call that must
/// never carry a Bearer header, and keeping it off `AuthAPI` breaks the DI
/// cycle with the token coordinator.
public struct SessionRefreshAPI: SessionRefreshing {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func refresh(refreshToken: String, userId: String) async throws -> Session {
        let response = try await client.fetch(PostRefresh(body: .init(refreshToken: refreshToken)))
        return try Session(from: response, userId: userId)
    }
}

private extension Session {
    /// Unparseable dates throw rather than fabricating a session with bogus expiries.
    init(from response: CoreAPI.RefreshResponse, userId: String) throws {
        guard
            let accessExpiry = ISO8601.date(from: response.accessTokenExpiresAt),
            let refreshExpiry = ISO8601.date(from: response.refreshTokenExpiresAt)
        else {
            throw APIError.decodingFailed(SessionRefreshDateError())
        }
        self.init(
            accessToken: response.accessToken,
            accessTokenExpiresAt: accessExpiry,
            refreshToken: response.refreshToken,
            refreshTokenExpiresAt: refreshExpiry,
            userId: userId
        )
    }
}

private struct SessionRefreshDateError: Error, CustomStringConvertible {
    var description: String { "Unparseable expiry date in /auth/refresh response" }
}
