import Domain
import Foundation
import SwiftData

/// SwiftData persistence row for one curated session client-state snapshot.
@Model
public final class SessionClientStateEntity: Entity {
    @Attribute(.unique) public private(set) var id: String
    var snapshotData: Data

    /// Creates a persistence row from a curated client-state snapshot.
    public init(_ snapshot: Domain.SessionClientStateSnapshot) {
        id = snapshot.id
        snapshotData = Self.encode(snapshot)
    }

    /// Replaces this row with a curated client-state snapshot.
    public func update(_ snapshot: Domain.SessionClientStateSnapshot) {
        snapshotData = Self.encode(snapshot)
    }

    /// Decodes this row into a curated client-state snapshot.
    public func makeSnapshot() throws -> Domain.SessionClientStateSnapshot {
        try JSONDecoder().decode(Domain.SessionClientStateSnapshot.self, from: snapshotData)
    }

    /// Builds a predicate matching one session ID.
    public static func singleItemPredicate(_ id: String) -> Predicate<SessionClientStateEntity> {
        #Predicate { $0.id == id }
    }

    /// Builds a predicate matching a set of session IDs.
    public static func multiItemPredicate(_ ids: Set<String>) -> Predicate<SessionClientStateEntity> {
        #Predicate { ids.contains($0.id) }
    }

    private static func encode(_ snapshot: Domain.SessionClientStateSnapshot) -> Data {
        do {
            return try JSONEncoder().encode(snapshot)
        } catch {
            preconditionFailure("failed to encode session client-state cache row: \(error)")
        }
    }
}
