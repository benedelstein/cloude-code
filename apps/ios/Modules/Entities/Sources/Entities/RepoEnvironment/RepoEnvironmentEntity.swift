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
    /// Encoded full domain snapshot. The default lets existing schemas open
    /// before the per-entity cache version clears legacy partial rows.
    var snapshotData: Data = Data()

    /// Clears rows written before full environment snapshots were persisted.
    public static var cacheVersion: Int { 2 }

    /// Creates a persistence row from a repo environment snapshot.
    public init(_ snapshot: Domain.RepoEnvironment) {
        id = snapshot.id
        repoId = snapshot.repoId
        name = snapshot.name
        updatedAt = snapshot.updatedAt
        snapshotData = Self.encode(snapshot)
    }

    /// Updates this persistence row from a repo environment snapshot.
    public func update(_ snapshot: Domain.RepoEnvironment) {
        repoId = snapshot.repoId
        name = snapshot.name
        updatedAt = snapshot.updatedAt
        snapshotData = Self.encode(snapshot)
    }

    /// Builds a domain snapshot from this persistence row.
    public func makeSnapshot() throws -> Domain.RepoEnvironment {
        try JSONDecoder().decode(Domain.RepoEnvironment.self, from: snapshotData)
    }

    public static func singleItemPredicate(_ id: String) -> Predicate<RepoEnvironmentEntity> {
        #Predicate { $0.id == id }
    }

    public static func multiItemPredicate(_ ids: Set<String>) -> Predicate<RepoEnvironmentEntity> {
        #Predicate { ids.contains($0.id) }
    }

    private static func encode(_ snapshot: Domain.RepoEnvironment) -> Data {
        do {
            return try JSONEncoder().encode(snapshot)
        } catch {
            preconditionFailure("failed to encode repo environment cache row: \(error)")
        }
    }
}
