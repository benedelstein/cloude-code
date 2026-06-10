import Domain
import Foundation

// Wire mirror of @repo/shared UserInfo. Replace with codegen output.
struct UserInfoDTO: Decodable, Sendable {
    let id: String
    let login: String
    let name: String?
    let avatarUrl: String?
}

extension Domain.User {
    init(from dto: UserInfoDTO) {
        self.init(id: dto.id, login: dto.login, name: dto.name, avatarUrl: dto.avatarUrl)
    }
}

private struct GetMe: APIRequest {
    typealias Response = UserInfoDTO

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
