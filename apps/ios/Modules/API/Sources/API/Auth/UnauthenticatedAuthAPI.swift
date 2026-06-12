import CoreAPI
import Domain
import Foundation

private struct GetGitHubAuthURL: APIRequest {
    typealias Response = CoreAPI.GitHubAuthUrlResponse

    var redirectUri: String

    var path: String { "auth/github" }
    var method: HTTPMethod { .get }
    var queryItems: [URLQueryItem] {
        [URLQueryItem(name: "redirectUri", value: redirectUri)]
    }
}

private struct PostToken: APIRequest {
    typealias Body = CoreAPI.NativeTokenRequest
    typealias Response = CoreAPI.NativeTokenResponse

    var body: CoreAPI.NativeTokenRequest?

    var path: String { "auth/native/token" }
    var method: HTTPMethod { .post }
    // No auth header: this is how a session is first obtained.
}

private struct PostRefresh: APIRequest {
    typealias Body = CoreAPI.RefreshRequest
    typealias Response = CoreAPI.RefreshResponse

    var body: CoreAPI.RefreshRequest?

    var path: String { "auth/native/refresh" }
    var method: HTTPMethod { .post }
    // No auth header: the refresh token in the body is the credential.
}

private struct PostNativeLogout: APIRequest {
    typealias Body = CoreAPI.NativeLogoutRequest
    typealias Response = CoreAPI.LogoutResponse

    var body: CoreAPI.NativeLogoutRequest?

    var path: String { "auth/native/logout" }
    var method: HTTPMethod { .post }
    // No auth header: the refresh token in the body is the credential.
}

/// The GitHub authorize page to open in a web-auth session, plus the state
/// nonce the callback must echo back.
public struct AuthorizePage: Sendable, Equatable {
    public let url: URL
    public let state: String
}

public struct SignInResult: Sendable {
    public let session: Session
    public let user: Domain.User
}

/// Sign-in via GitHub OAuth: fetch the authorize URL, then exchange the
/// callback's code for a native token pair.
public protocol SignInProviding: Sendable {
    func authorizePage(redirectUri: String) async throws -> AuthorizePage
    func exchangeCode(code: String, state: String) async throws -> SignInResult
}

/// Rotates a session's token pair via `POST /auth/native/refresh`.
public protocol SessionRefreshing: Sendable {
    func refresh(refreshToken: String) async throws -> Session
}

/// Revokes a native refresh-token family via `POST /auth/native/logout`.
public protocol SessionRevoking: Sendable {
    func logout(refreshToken: String) async throws
}

public typealias UnauthenticatedAuthAPIProviding = SignInProviding & SessionRefreshing & SessionRevoking

/// Provider-free auth routes. These endpoints either happen before sign-in or
/// use the refresh token in the body, so they must never attach Bearer auth.
public struct UnauthenticatedAuthAPI: UnauthenticatedAuthAPIProviding {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func authorizePage(redirectUri: String) async throws -> AuthorizePage {
        let response = try await client.fetch(GetGitHubAuthURL(redirectUri: redirectUri))
        guard let url = URL(string: response.url) else {
            throw APIError.decodingFailed(SignInResponseError.invalidAuthorizeURL)
        }
        return AuthorizePage(url: url, state: response.state)
    }

    public func exchangeCode(code: String, state: String) async throws -> SignInResult {
        let response = try await client.fetch(PostToken(body: .init(code: code, state: state)))
        let session = try Session(
            nativeAccessToken: response.accessToken,
            refreshToken: response.refreshToken,
            refreshTokenExpiresAt: response.refreshTokenExpiresAt
        )
        return SignInResult(session: session, user: User(from: response.user))
    }

    public func refresh(refreshToken: String) async throws -> Session {
        let response = try await client.fetch(PostRefresh(body: .init(refreshToken: refreshToken)))
        return try Session(
            nativeAccessToken: response.accessToken,
            refreshToken: response.refreshToken,
            refreshTokenExpiresAt: response.refreshTokenExpiresAt
        )
    }

    public func logout(refreshToken: String) async throws {
        _ = try await client.fetch(PostNativeLogout(body: .init(refreshToken: refreshToken)))
    }
}

private enum SignInResponseError: Error, CustomStringConvertible {
    case invalidAuthorizeURL

    var description: String {
        switch self {
        case .invalidAuthorizeURL:
            return "Unparseable authorize URL in /auth/github response"
        }
    }
}
