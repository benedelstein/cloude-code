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

    var path: String { "auth/me" }
    var method: HTTPMethod { .get }
}

public protocol AuthAPIProviding: Sendable {
    func me() async throws -> User
}

public struct AuthAPI: AuthAPIProviding {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func me() async throws -> User {
        try await User(from: client.fetch(GetMe()))
    }
}
