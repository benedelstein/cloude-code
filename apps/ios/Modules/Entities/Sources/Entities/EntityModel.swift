import Observation

/// A MainActor-isolated, reference-identity observable model. One canonical
/// instance exists per id (enforced by `EntityStore`); views mutate it in
/// place and canonical data merges in via `update(from:)`.
///
/// `Snapshot` is the Sendable domain struct that crosses actor boundaries
/// (network, disk, sockets). Models never leave the main actor as data —
/// they are constructed from and serialized to snapshots.
@MainActor
public protocol EntityModel: Identifiable, Observable where ID == String {
    // does it need to be observable at protocol level?
    associatedtype Snapshot: Sendable & Identifiable<String>
    associatedtype EntityType: Entity where EntityType.Snapshot == Snapshot

    init(_ snapshot: Snapshot)
    func update(from snapshot: Snapshot)

    var snapshot: Snapshot { get }
}

public extension EntityModel {
    /// Skips no-op writes so @Observable doesn't invalidate views needlessly.
    func updateIfChanged<Value: Equatable>(
        _ keyPath: ReferenceWritableKeyPath<Self, Value>,
        to value: Value
    ) {
        if self[keyPath: keyPath] != value {
            self[keyPath: keyPath] = value
        }
    }
}
