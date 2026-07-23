import Domain
import Observation

/// Per-session cache for curated client-state snapshots.
@MainActor
@Observable
public final class SessionClientStateStore {
    public typealias Model = SessionClientStateModel

    @ObservationIgnored private let cache: Cache?
    @ObservationIgnored private let entityStore: EntityStore<Model>
    @ObservationIgnored private var lastWriteTask: Task<Void, Never>?

    /// Creates a session client-state store.
    public init(cache: Cache? = nil) {
        self.cache = cache
        entityStore = EntityStore(cache: cache)
    }

    public subscript(sessionId: String) -> Domain.SessionClientStateSnapshot? {
        entityStore[sessionId]?.snapshot
    }

    /// Loads one cached session snapshot, deleting an unreadable row.
    public func snapshot(sessionId: String) async -> Domain.SessionClientStateSnapshot? {
        if let snapshot = self[sessionId] {
            return snapshot
        }
        await lastWriteTask?.value
        do {
            return try await entityStore.get([sessionId], scopes: [.memory, .disk]).first?.snapshot
        } catch {
            Logger.warning("Failed to load cached session client state: \(error)")
            entityStore.delete([sessionId])
            return nil
        }
    }

    /// Saves a curated session snapshot to memory and disk.
    public func save(_ snapshot: Domain.SessionClientStateSnapshot) {
        entityStore.putMemory([snapshot])
        guard let cache else {
            return
        }

        enqueueWrite {
            try await cache.put(SessionClientStateEntity.self, snapshots: [snapshot])
        }
    }

    /// Deletes one session's cached client state.
    public func delete(sessionId: String) {
        entityStore.deleteMemory([sessionId])
        guard let cache else {
            return
        }

        enqueueWrite {
            try await cache.delete(SessionClientStateEntity.self, ids: [sessionId])
        }
    }

    /// Deletes every cached session client-state snapshot.
    public func deleteAll() async throws {
        await lastWriteTask?.value
        lastWriteTask = nil
        try await entityStore.deleteAll()
    }

    private func enqueueWrite(
        _ operation: @MainActor @Sendable @escaping () async throws -> Void
    ) {
        let previousWriteTask = lastWriteTask
        lastWriteTask = Task { @MainActor in
            await previousWriteTask?.value
            do {
                try await operation()
            } catch {
                Logger.error("session client-state disk write failed: \(error)")
            }
        }
    }
}
