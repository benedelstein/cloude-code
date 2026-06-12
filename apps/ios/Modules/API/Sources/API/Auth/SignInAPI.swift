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

/// Provider-free by construction: both calls happen while signed out and must
/// never carry a Bearer header.
public struct SignInAPI: SignInProviding {
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
