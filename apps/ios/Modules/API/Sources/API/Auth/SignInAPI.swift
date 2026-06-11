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
    typealias Body = CoreAPI.TokenRequest
    typealias Response = CoreAPI.TokenResponse

    var body: CoreAPI.TokenRequest?

    var path: String { "auth/token" }
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
        let response = try await client.fetch(PostToken(
            body: .init(code: code, state: state, client: .native)
        ))
        // The native fields are optional on the shared TokenResponse (web
        // omits them); for a native exchange their absence is a server bug —
        // fail rather than fabricate a session.
        guard
            let accessExpiryString = response.accessTokenExpiresAt,
            let refreshToken = response.refreshToken,
            let refreshExpiryString = response.refreshTokenExpiresAt,
            let accessExpiry = ISO8601.date(from: accessExpiryString),
            let refreshExpiry = ISO8601.date(from: refreshExpiryString)
        else {
            throw APIError.decodingFailed(SignInResponseError.missingNativeTokenFields)
        }
        let session = Session(
            accessToken: response.token,
            accessTokenExpiresAt: accessExpiry,
            refreshToken: refreshToken,
            refreshTokenExpiresAt: refreshExpiry,
            userId: response.user.id
        )
        return SignInResult(session: session, user: User(from: response.user))
    }
}

private enum SignInResponseError: Error, CustomStringConvertible {
    case invalidAuthorizeURL
    case missingNativeTokenFields

    var description: String {
        switch self {
        case .invalidAuthorizeURL:
            return "Unparseable authorize URL in /auth/github response"
        case .missingNativeTokenFields:
            return "Missing or unparseable native token fields in /auth/token response"
        }
    }
}
