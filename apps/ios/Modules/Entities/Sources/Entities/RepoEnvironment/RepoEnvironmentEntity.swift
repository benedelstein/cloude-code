import Domain
import Foundation
import SwiftData

/// SwiftData persistence row for one cached repo environment.
@Model
public final class RepoEnvironmentEntity: Entity {
    @Attribute(.unique) public private(set) var id: String
    var repoId: Int
    var name: String
    var updatedAt: String

    /// Creates a persistence row from a repo environment snapshot.
    public init(_ snapshot: Domain.RepoEnvironment) {
        id = snapshot.id
        repoId = snapshot.repoId
        name = snapshot.name
        updatedAt = snapshot.updatedAt
    }

    /// Updates this persistence row from a repo environment snapshot.
    public func update(_ snapshot: Domain.RepoEnvironment) {
        repoId = snapshot.repoId
        name = snapshot.name
        updatedAt = snapshot.updatedAt
    }

    /// Builds a domain snapshot from this persistence row.
    public func makeSnapshot() throws -> Domain.RepoEnvironment {
        Domain.RepoEnvironment(id: id, repoId: repoId, name: name, updatedAt: updatedAt)
    }

    public static func singleItemPredicate(_ id: String) -> Predicate<RepoEnvironmentEntity> {
        #Predicate { $0.id == id }
    }

    public static func multiItemPredicate(_ ids: Set<String>) -> Predicate<RepoEnvironmentEntity> {
        #Predicate { ids.contains($0.id) }
    }
}
