import CoreAPI
import Foundation

private struct ListRepos: APIRequest {
    typealias Response = ListReposResponse

    var limit: Int?
    var cursor: String?
    var headers: [String: String]

    var path: String { "repos" }
    var method: HTTPMethod { .get }
    var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        if let limit {
            items.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        if let cursor {
            items.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return items
    }
}

private struct SearchRepos: APIRequest {
    typealias Response = SearchReposResponse

    var query: String
    var limit: Int?
    var headers: [String: String]

    var path: String { "repos/search" }
    var method: HTTPMethod { .get }
    var queryItems: [URLQueryItem] {
        var items = [URLQueryItem(name: "q", value: query)]
        if let limit {
            items.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        return items
    }
}

private struct ListBranches: APIRequest {
    typealias Response = ListBranchesResponse

    var repoId: Int
    var limit: Int?
    var cursor: String?
    var headers: [String: String]

    var path: String { "repos/\(repoId)/branches" }
    var method: HTTPMethod { .get }
    var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        if let limit {
            items.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        if let cursor {
            items.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return items
    }
}

/// Repository HTTP API (`/repos/*`) used when creating a new session.
public protocol ReposAPIProviding: Sendable {
    func listRepos(limit: Int?, cursor: String?) async throws -> ListReposResponse
    func searchRepos(query: String, limit: Int?) async throws -> SearchReposResponse
    func branches(repoId: Int, limit: Int?, cursor: String?) async throws -> ListBranchesResponse
}

public extension ReposAPIProviding {
    func listRepos() async throws -> ListReposResponse {
        try await listRepos(limit: nil, cursor: nil)
    }

    func searchRepos(query: String) async throws -> SearchReposResponse {
        try await searchRepos(query: query, limit: nil)
    }

    func branches(repoId: Int) async throws -> ListBranchesResponse {
        try await branches(repoId: repoId, limit: nil, cursor: nil)
    }
}

/// Concrete repository API backed by `APIClient`.
public struct ReposAPI: ReposAPIProviding {
    private let client: APIClient
    private let tokenProvider: any AuthTokenProviding

    public init(client: APIClient, tokenProvider: any AuthTokenProviding) {
        self.client = client
        self.tokenProvider = tokenProvider
    }

    public func listRepos(limit: Int?, cursor: String?) async throws -> ListReposResponse {
        try await client.fetch(ListRepos(
            limit: limit,
            cursor: cursor,
            headers: tokenProvider.bearerHeaders()
        ))
    }

    public func searchRepos(query: String, limit: Int?) async throws -> SearchReposResponse {
        try await client.fetch(SearchRepos(
            query: query,
            limit: limit,
            headers: tokenProvider.bearerHeaders()
        ))
    }

    public func branches(repoId: Int, limit: Int?, cursor: String?) async throws -> ListBranchesResponse {
        try await client.fetch(ListBranches(
            repoId: repoId,
            limit: limit,
            cursor: cursor,
            headers: tokenProvider.bearerHeaders()
        ))
    }
}
