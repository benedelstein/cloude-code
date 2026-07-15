import CoreAPI
import Domain
import Foundation

private struct ListRepoEnvironments: APIRequest {
    typealias Response = ListRepoEnvironmentsResponse

    var repoId: Int
    var headers: [String: String]

    var path: String { "repos/\(repoId)/environments" }
    var method: HTTPMethod { .get }
}

private struct GetDefaultNetworkAllowlist: APIRequest {
    typealias Response = DefaultNetworkAllowlistResponse

    var headers: [String: String]

    var path: String { "environments/default-allowlist" }
    var method: HTTPMethod { .get }
}

private struct CreateRepoEnvironment: APIRequest {
    typealias Response = RepoEnvironmentResponse

    var repoId: Int
    var headers: [String: String]
    var body: RepoEnvironmentMutationBody?

    var path: String { "repos/\(repoId)/environments" }
    var method: HTTPMethod { .post }
}

private struct UpdateRepoEnvironment: APIRequest {
    typealias Response = RepoEnvironmentResponse

    var repoId: Int
    var environmentId: String
    var headers: [String: String]
    var body: RepoEnvironmentMutationBody?

    var path: String { "repos/\(repoId)/environments/\(environmentId)" }
    var method: HTTPMethod { .patch }
}

/// Mutation body shared by create and update environment requests.
///
/// This encoder deliberately emits `startupScript: null` for a nil value. The
/// update endpoint treats an omitted key as unchanged and an explicit null as
/// clearing the existing startup script.
struct RepoEnvironmentMutationBody: Encodable, Sendable {
    let name: String
    let network: CoreAPI.NetworkAccessConfig
    let plainEnvVars: CoreAPI.PlainEnvVars
    let startupScript: String?

    init(_ input: Domain.RepoEnvironment.Input) {
        name = input.name
        network = input.network.coreNetwork
        plainEnvVars = input.plainEnvVars
        startupScript = input.startupScript
    }

    private enum CodingKeys: String, CodingKey {
        case name
        case network
        case plainEnvVars
        case startupScript
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(network, forKey: .network)
        try container.encode(plainEnvVars, forKey: .plainEnvVars)
        if let startupScript {
            try container.encode(startupScript, forKey: .startupScript)
        } else {
            try container.encodeNil(forKey: .startupScript)
        }
    }
}

private extension Domain.RepoEnvironment.Network {
    var coreNetwork: CoreAPI.NetworkAccessConfig {
        switch self {
        case .locked:
            .locked(.init())
        case .default:
            .default(.init())
        case let .custom(extraAllowlist, includeDefaultAllowlist):
            .custom(.init(
                extraAllowlist: extraAllowlist,
                includeDefaultAllowlist: includeDefaultAllowlist
            ))
        case .open:
            .open(.init())
        case let .unknown(mode):
            .unknown(type: mode)
        }
    }
}

private extension CoreAPI.NetworkAccessConfig {
    var domainNetwork: Domain.RepoEnvironment.Network {
        switch self {
        case .locked:
            .locked
        case .default:
            .default
        case let .custom(config):
            .custom(
                extraAllowlist: config.extraAllowlist,
                includeDefaultAllowlist: config.includeDefaultAllowlist
            )
        case .open:
            .open
        case let .unknown(type):
            .unknown(type)
        }
    }
}

private extension CoreAPI.RepoEnvironment {
    var domainEnvironment: Domain.RepoEnvironment {
        Domain.RepoEnvironment(
            id: id,
            repoId: repoId,
            name: name,
            network: network.domainNetwork,
            plainEnvVars: plainEnvVars,
            startupScript: startupScript,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

/// Repo environments HTTP API (`/repos/{repoId}/environments`).
public protocol RepoEnvironmentsAPIProviding: Sendable {
    /// Returns the server-managed default network allowlist.
    func defaultNetworkAllowlist() async throws -> [String]

    /// Lists the current user's environments for a repository.
    func listEnvironments(repoId: Int) async throws -> [Domain.RepoEnvironment]

    /// Creates an environment for a repository.
    func createEnvironment(
        repoId: Int,
        input: Domain.RepoEnvironment.Input
    ) async throws -> Domain.RepoEnvironment

    /// Replaces the editable fields of an existing environment.
    func updateEnvironment(
        repoId: Int,
        environmentId: String,
        input: Domain.RepoEnvironment.Input
    ) async throws -> Domain.RepoEnvironment
}

/// Concrete repo environments API backed by `APIClient`.
public struct RepoEnvironmentsAPI: RepoEnvironmentsAPIProviding {
    private let client: APIClient
    private let tokenProvider: any AuthTokenProviding

    public init(client: APIClient, tokenProvider: any AuthTokenProviding) {
        self.client = client
        self.tokenProvider = tokenProvider
    }

    /// Returns the server-managed default network allowlist.
    public func defaultNetworkAllowlist() async throws -> [String] {
        try await client.fetch(GetDefaultNetworkAllowlist(
            headers: tokenProvider.bearerHeaders()
        )).domains
    }

    /// Lists the current user's environments for a repository.
    public func listEnvironments(repoId: Int) async throws -> [Domain.RepoEnvironment] {
        try await client.fetch(ListRepoEnvironments(
            repoId: repoId,
            headers: tokenProvider.bearerHeaders()
        )).environments.map(\.domainEnvironment)
    }

    /// Creates an environment for a repository.
    public func createEnvironment(
        repoId: Int,
        input: Domain.RepoEnvironment.Input
    ) async throws -> Domain.RepoEnvironment {
        try await client.fetch(CreateRepoEnvironment(
            repoId: repoId,
            headers: tokenProvider.bearerHeaders(),
            body: RepoEnvironmentMutationBody(input)
        )).environment.domainEnvironment
    }

    /// Replaces the editable fields of an existing environment.
    public func updateEnvironment(
        repoId: Int,
        environmentId: String,
        input: Domain.RepoEnvironment.Input
    ) async throws -> Domain.RepoEnvironment {
        try await client.fetch(UpdateRepoEnvironment(
            repoId: repoId,
            environmentId: environmentId,
            headers: tokenProvider.bearerHeaders(),
            body: RepoEnvironmentMutationBody(input)
        )).environment.domainEnvironment
    }
}
