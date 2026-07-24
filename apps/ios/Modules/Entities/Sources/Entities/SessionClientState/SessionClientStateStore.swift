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
    @ObservationIgnored private var mutationVersions: [String: Int] = [:]

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
        let mutationVersion = mutationVersions[sessionId, default: 0]
        let pendingWrite = lastWriteTask
        await pendingWrite?.value
        // Do not install a disk result if this session was saved or deleted
        // while the fetch path was suspended.
        guard !Task.isCancelled else {
            return nil
        }
        guard mutationVersion == mutationVersions[sessionId, default: 0] else {
            return self[sessionId]
        }
        if let snapshot = self[sessionId] {
            return snapshot
        }
        guard let cache else {
            return nil
        }

        do {
            let snapshots = try await cache.fetch(
                SessionClientStateEntity.self,
                ids: [sessionId]
            )
            guard !Task.isCancelled else {
                return nil
            }
            guard mutationVersion == mutationVersions[sessionId, default: 0] else {
                return self[sessionId]
            }
            return entityStore.putMemory(snapshots).first?.snapshot
        } catch {
            guard mutationVersion == mutationVersions[sessionId, default: 0] else {
                return self[sessionId]
            }
            Logger.warning("Failed to load cached session client state: \(error)")
            delete(sessionId: sessionId)
            return nil
        }
    }

    /// Saves a curated session snapshot to memory and disk.
    public func save(_ snapshot: Domain.SessionClientStateSnapshot) {
        mutationVersions[snapshot.id, default: 0] += 1
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
        mutationVersions[sessionId, default: 0] += 1
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
