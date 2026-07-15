import Foundation
import SwiftData

/// A SwiftData row type paired with the Sendable snapshot struct that crosses
/// actor boundaries. Entity instances never leave `Cache`'s model actor —
/// they are mapped to/from snapshots at the boundary.
public protocol Entity: PersistentModel where ID == String {
    associatedtype Snapshot: Sendable & Identifiable<String>

    /// Increment this version to reset only this entity type's cached rows.
    static var cacheVersion: Int { get }

    init(_ snapshot: Snapshot)
    func update(_ snapshot: Snapshot)

    /// Builds a snapshot from a persisted row.
    func makeSnapshot() throws -> Snapshot

    /// NOTE: SWIFTDATA CAN'T HANDLE GENERICS IN PREDICATES, so each entity
    /// concretely provides its own id lookups.
    /// See https://forums.swift.org/t/swiftdata-predicate-does-not-handle-protocol-witness/68256/3
    static func singleItemPredicate(_ id: String) -> Predicate<Self>
    static func multiItemPredicate(_ ids: Set<String>) -> Predicate<Self>
}

public extension Cache {
    func fetch<E: Entity>(_ type: E.Type, ids: Set<String>) async throws -> [E.Snapshot] {
        guard !ids.isEmpty else { return [] }

        return try await fetch(type, predicate: E.multiItemPredicate(ids))
    }

    /// Predicate/sort-based fetch. Pass nil predicate to load all rows.
    func fetch<E: Entity>(
        _ type: E.Type,
        predicate: Predicate<E>? = nil,
        sortBy: [SortDescriptor<E>] = [],
        limit: Int? = nil
    ) async throws -> [E.Snapshot] {
        // NOTE: descriptors must be created outside the background closure
        // (crashed inside it on iOS 18.3 — see Gallery).
        var descriptor = FetchDescriptor<E>(predicate: predicate)
        if !sortBy.isEmpty {
            descriptor.sortBy = sortBy
        }
        descriptor.fetchLimit = limit
        let fetchDescriptor = descriptor
        return try await runBackgroundTask { context in
            try context.fetch(fetchDescriptor).map { entity in
                try entity.makeSnapshot()
            }
        }
    }

    func count<E: Entity>(_ type: E.Type, predicate: Predicate<E>? = nil) async throws -> Int {
        let descriptor = FetchDescriptor<E>(predicate: predicate)
        return try await runBackgroundTask { context in
            try context.fetchCount(descriptor)
        }
    }

    /// Upserts by snapshot id: existing rows are updated, new ids inserted.
    func put<E: Entity>(_ type: E.Type, snapshots: [E.Snapshot]) async throws {
        guard !snapshots.isEmpty else { return }

        let ids = Set(snapshots.map(\.id))
        let descriptor = FetchDescriptor<E>(predicate: E.multiItemPredicate(ids))
        try await runBackgroundTask { context in
            let existingById = try context.fetch(descriptor)
                .reduce(into: [String: E]()) { $0[$1.id] = $1 }

            for snapshot in snapshots {
                if let entity = existingById[snapshot.id] {
                    entity.update(snapshot)
                } else {
                    context.insert(E(snapshot))
                }
            }
        }
    }

    func delete<E: Entity>(_ type: E.Type, ids: Set<String>) async throws {
        guard !ids.isEmpty else { return }

        let predicate = E.multiItemPredicate(ids)
        try await runBackgroundTask { context in
            try context.delete(model: E.self, where: predicate)
        }
    }

    /// Deletes every persisted row for one entity type without affecting other tables.
    func deleteAll<E: Entity>(_ type: E.Type) async throws {
        try await runBackgroundTask { context in
            try E.deleteAll(in: context)
        }
    }
}

public extension Entity {
    /// Default per-entity cache version.
    static var cacheVersion: Int { 1 }

    /// Stable metadata key for the entity's cache version.
    static var cacheVersionKey: String {
        "cache.entity.\(String(reflecting: Self.self)).version"
    }

    /// Deletes every persisted row for this entity type.
    static func deleteAll(in context: ModelContext) throws {
        try context.delete(model: Self.self)
    }
}
