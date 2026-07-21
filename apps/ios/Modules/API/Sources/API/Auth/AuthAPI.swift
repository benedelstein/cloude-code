import CoreAPI
import Domain
import Foundation

extension Domain.User {
    init(from info: CoreAPI.UserInfo) {
        self.init(id: info.id, login: info.login, name: info.name, avatarUrl: info.avatarUrl)
    }
}

private struct GetMe: APIRequest {
    typealias Response = CoreAPI.UserInfo

    var headers: [String: String]

    var path: String { "auth/me" }
    var method: HTTPMethod { .get }
}

private struct PostGitHubInstallationStart: APIRequest {
    typealias Response = CoreAPI.GitHubAuthUrlResponse

    var redirectUri: String
    var headers: [String: String]

    var path: String { "auth/github/install/start" }
    var method: HTTPMethod { .post }
    var queryItems: [URLQueryItem] {
        [URLQueryItem(name: "redirectUri", value: redirectUri)]
    }
}

public protocol AuthAPIProviding: Sendable {
    /// Returns a one-time GitHub App installation page that redirects back to iOS.
    func githubInstallationPage(redirectUri: String) async throws -> AuthorizePage

    /// Returns the currently authenticated user.
    func me() async throws -> User
}

public struct AuthAPI: AuthAPIProviding {
    private let client: APIClient
    private let tokenProvider: any AuthTokenProviding

    public init(client: APIClient, tokenProvider: any AuthTokenProviding) {
        self.client = client
        self.tokenProvider = tokenProvider
    }

    public func githubInstallationPage(redirectUri: String) async throws -> AuthorizePage {
        let response = try await client.fetch(PostGitHubInstallationStart(
            redirectUri: redirectUri,
            headers: tokenProvider.bearerHeaders()
        ))
        guard let url = URL(string: response.url) else {
            throw APIError.decodingFailed(GitHubInstallationResponseError.invalidURL)
        }
        return AuthorizePage(url: url, state: response.state)
    }

    public func me() async throws -> User {
        try await User(from: client.fetch(GetMe(headers: tokenProvider.bearerHeaders())))
    }
}

private enum GitHubInstallationResponseError: Error, CustomStringConvertible {
    case invalidURL

    var description: String {
        switch self {
        case .invalidURL:
            "Unparseable installation URL in /auth/github/install/start response"
        }
    }
}
