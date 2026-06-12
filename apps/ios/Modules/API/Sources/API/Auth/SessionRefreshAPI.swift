import CoreAPI
import Domain
import Foundation

private struct PostRefresh: APIRequest {
    typealias Body = CoreAPI.RefreshRequest
    typealias Response = CoreAPI.RefreshResponse

    var body: CoreAPI.RefreshRequest?

    var path: String { "auth/native/refresh" }
    var method: HTTPMethod { .post }
    // No auth header: the refresh token in the body is the credential.
}

/// Rotates a session's token pair via `POST /auth/native/refresh`.
public protocol SessionRefreshing: Sendable {
    func refresh(refreshToken: String) async throws -> Session
}

/// Provider-free by construction: refresh is the one auth call that must
/// never carry a Bearer header, and keeping it off `AuthAPI` breaks the DI
/// cycle with the token coordinator.
public struct SessionRefreshAPI: SessionRefreshing {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func refresh(refreshToken: String) async throws -> Session {
        let response = try await client.fetch(PostRefresh(body: .init(refreshToken: refreshToken)))
        return try Session(
            nativeAccessToken: response.accessToken,
            refreshToken: response.refreshToken,
            refreshTokenExpiresAt: response.refreshTokenExpiresAt
        )
    }
}
