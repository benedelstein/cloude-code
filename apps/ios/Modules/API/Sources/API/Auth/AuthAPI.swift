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

public protocol AuthAPIProviding: Sendable {
    func me() async throws -> User
}

public struct AuthAPI: AuthAPIProviding {
    private let client: APIClient
    private let tokenProvider: any AuthTokenProviding

    public init(client: APIClient, tokenProvider: any AuthTokenProviding) {
        self.client = client
        self.tokenProvider = tokenProvider
    }

    public func me() async throws -> User {
        try await User(from: client.fetch(GetMe(headers: tokenProvider.bearerHeaders())))
    }
}
