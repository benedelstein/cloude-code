import Domain
import Observation

/// Observable view model for one cached repo environment.
@MainActor
@Observable
public final class RepoEnvironmentModel: EntityModel {
    public typealias EntityType = RepoEnvironmentEntity

    public let id: String
    public var repoId: Int
    public var name: String
    public var network: Domain.RepoEnvironment.Network
    public var plainEnvVars: [String: String]
    public var startupScript: String?
    public var createdAt: String
    public var updatedAt: String

    /// Creates a model from a repo environment snapshot.
    public init(_ snapshot: Domain.RepoEnvironment) {
        id = snapshot.id
        repoId = snapshot.repoId
        name = snapshot.name
        network = snapshot.network
        plainEnvVars = snapshot.plainEnvVars
        startupScript = snapshot.startupScript
        createdAt = snapshot.createdAt
        updatedAt = snapshot.updatedAt
    }

    /// Merges a canonical snapshot into this model in place.
    public func update(from snapshot: Domain.RepoEnvironment) {
        updateIfChanged(\.repoId, to: snapshot.repoId)
        updateIfChanged(\.name, to: snapshot.name)
        updateIfChanged(\.network, to: snapshot.network)
        updateIfChanged(\.plainEnvVars, to: snapshot.plainEnvVars)
        updateIfChanged(\.startupScript, to: snapshot.startupScript)
        updateIfChanged(\.createdAt, to: snapshot.createdAt)
        updateIfChanged(\.updatedAt, to: snapshot.updatedAt)
    }

    public var snapshot: Domain.RepoEnvironment {
        Domain.RepoEnvironment(
            id: id,
            repoId: repoId,
            name: name,
            network: network,
            plainEnvVars: plainEnvVars,
            startupScript: startupScript,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}
