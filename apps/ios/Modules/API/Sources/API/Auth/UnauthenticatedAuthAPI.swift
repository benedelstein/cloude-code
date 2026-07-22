import CoreAPI
import Domain
import Foundation

private struct PostNativeSignInStart: APIRequest {
    typealias Body = CoreAPI.NativeGitHubSignInStartRequest
    typealias Response = CoreAPI.GitHubSignInStartResponse

    var body: CoreAPI.NativeGitHubSignInStartRequest?

    var path: String { "auth/github/native/start" }
    var method: HTTPMethod { .post }
    // No auth header: this begins the flow that first obtains a session.
}

private struct PostNativeSignInComplete: APIRequest {
    typealias Body = CoreAPI.GitHubSignInCompleteRequest
    typealias Response = CoreAPI.NativeGitHubSignInCompleteResponse

    var body: CoreAPI.GitHubSignInCompleteRequest?

    var path: String { "auth/github/native/complete" }
    var method: HTTPMethod { .post }
    // No auth header: the attempt's claim token is the credential.
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

/// A page to open in a web-auth session, plus the state nonce its callback
/// must echo back. Used by GitHub App repository management.
public struct AuthorizePage: Sendable, Equatable {
    public let url: URL
    public let state: String

    public init(url: URL, state: String) {
        self.url = url
        self.state = state
    }
}

/// A server-owned GitHub sign-in attempt.
///
/// `attemptId` is non-secret and travels on the custom-scheme callback.
/// `claimToken` authorizes issuing this app's session and must stay in memory
/// for the active sign-in operation only: never Keychain, `UserDefaults`,
/// other persistence, analytics, or logs.
public struct GitHubSignInAttempt: Sendable, Equatable {
    public let authorizeURL: URL
    public let attemptId: String
    public let claimToken: String

    public init(authorizeURL: URL, attemptId: String, claimToken: String) {
        self.authorizeURL = authorizeURL
        self.attemptId = attemptId
        self.claimToken = claimToken
    }
}

public struct SignInResult: Sendable {
    public let session: Session
    public let user: Domain.User

    public init(session: Session, user: Domain.User) {
        self.session = session
        self.user = user
    }
}

/// GitHub sign-in: start a server-owned attempt, then claim the completed
/// identity. The app never sees or exchanges a GitHub authorization code.
public protocol SignInProviding: Sendable {
    func startSignIn(redirectUri: String) async throws -> GitHubSignInAttempt
    func completeSignIn(attemptId: String, claimToken: String) async throws -> SignInResult
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

    public func startSignIn(redirectUri: String) async throws -> GitHubSignInAttempt {
        let response = try await client.fetch(PostNativeSignInStart(
            body: .init(redirectUri: redirectUri)
        ))
        guard let url = URL(string: response.authorizeUrl) else {
            throw APIError.decodingFailed(SignInResponseError.invalidAuthorizeURL)
        }
        return GitHubSignInAttempt(
            authorizeURL: url,
            attemptId: response.attemptId,
            claimToken: response.claimToken
        )
    }

    public func completeSignIn(
        attemptId: String,
        claimToken: String
    ) async throws -> SignInResult {
        let response = try await client.fetch(PostNativeSignInComplete(
            body: .init(attemptId: attemptId, claimToken: claimToken)
        ))
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

public extension APIError {
    /// The sign-in attempt is valid but its OAuth callback has not landed yet.
    var isSignInNotReady: Bool {
        if case let .httpError(_, code, _) = self {
            return code == "SIGN_IN_NOT_READY"
        }
        return false
    }
}

private enum SignInResponseError: Error, CustomStringConvertible {
    case invalidAuthorizeURL

    var description: String {
        switch self {
        case .invalidAuthorizeURL:
            return "Unparseable authorize URL in /auth/github/native/start response"
        }
    }
}
