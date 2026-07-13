import CoreAPI
import Foundation

private struct ListRepoEnvironments: APIRequest {
    typealias Response = ListRepoEnvironmentsResponse

    var repoId: Int
    var headers: [String: String]

    var path: String { "repos/\(repoId)/environments" }
    var method: HTTPMethod { .get }
}

/// Repo environments HTTP API (`/repos/{repoId}/environments`) used when
/// creating a new session.
public protocol RepoEnvironmentsAPIProviding: Sendable {
    func listEnvironments(repoId: Int) async throws -> ListRepoEnvironmentsResponse
}

/// Concrete repo environments API backed by `APIClient`.
public struct RepoEnvironmentsAPI: RepoEnvironmentsAPIProviding {
    private let client: APIClient
    private let tokenProvider: any AuthTokenProviding

    public init(client: APIClient, tokenProvider: any AuthTokenProviding) {
        self.client = client
        self.tokenProvider = tokenProvider
    }

    /// Lists the current user's environments for a repository.
    public func listEnvironments(repoId: Int) async throws -> ListRepoEnvironmentsResponse {
        try await client.fetch(ListRepoEnvironments(
            repoId: repoId,
            headers: tokenProvider.bearerHeaders()
        ))
    }
}
