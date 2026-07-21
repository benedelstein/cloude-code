import Domain
import Foundation
import Observation
import SwiftData

/// Session-scoped message cache backed by `EntityStore`.
@MainActor
@Observable
public final class SessionMessageStore {
    public typealias Model = SessionMessageWrapper

    @ObservationIgnored private let cache: Cache?
    @ObservationIgnored private let entityStore: EntityStore<Model>
    @ObservationIgnored private var messageIDsBySessionID: [String: [String]] = [:]
    @ObservationIgnored private var pendingWriteTask: Task<Void, Never>?

    public private(set) var loadedSessionIDs: Set<String> = []

    /// Creates a session message store.
    public init(cache: Cache? = nil) {
        self.cache = cache
        entityStore = EntityStore(cache: cache)
    }

    public subscript(messageID: String) -> Domain.SessionMessage? {
        entityStore[messageID]?.message
    }

    /// Returns cached messages for a session, sorted by cached creation date.
    public func messages(sessionId: String) async throws -> [Domain.SessionMessage] {
        try await records(sessionId: sessionId).map(\.message)
    }

    /// Returns cached message records, including in-progress turn identity.
    public func records(sessionId: String) async throws -> [SessionMessageData] {
        await pendingWriteTask?.value
        if let models = modelsFromMemory(sessionId: sessionId) {
            return models.map(\.snapshot)
        }

        do {
            let models = try await entityStore.getFromDisk(
                predicate: #Predicate<SessionMessageEntity> {
                    $0.sessionId == sessionId
                },
                sortBy: [SortDescriptor(\.createdAt, order: .forward)]
            )

            index(models, for: sessionId)
            loadedSessionIDs.insert(sessionId)

            return models.map(\.snapshot)
        } catch {
            try? await deleteUnreadableSessionCache(sessionId: sessionId)
            return []
        }
    }

    /// Replaces one session's cache with a canonical server snapshot.
    public func replace(
        sessionId: String,
        with messages: [Domain.SessionMessage]
    ) async throws {
        await pendingWriteTask?.value
        guard let cache else {
            let models = entityStore.putMemory(snapshots(for: messages, sessionId: sessionId))
            index(models, for: sessionId)
            loadedSessionIDs.insert(sessionId)
            return
        }

        let snapshots = snapshots(for: messages, sessionId: sessionId)
        let snapshotIDs = Set(snapshots.map(\.id))
        let predicate = #Predicate<SessionMessageEntity> {
            $0.sessionId == sessionId
        }
        let descriptor = FetchDescriptor<SessionMessageEntity>(
            predicate: predicate,
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )

        let staleIDs = try await cache.runBackgroundTask { context in
            let existingRows = try context.fetch(descriptor)
            let existingByID = existingRows.reduce(into: [String: SessionMessageEntity]()) { result, row in
                result[row.id] = row
            }
            var staleIDs = Set<String>()

            for row in existingRows where !snapshotIDs.contains(row.id) {
                staleIDs.insert(row.id)
                context.delete(row)
            }

            for snapshot in snapshots {
                if let row = existingByID[snapshot.id] {
                    row.update(snapshot)
                } else {
                    context.insert(SessionMessageEntity(snapshot))
                }
            }

            return staleIDs
        }

        entityStore.deleteMemory(staleIDs)
        let models = entityStore.putMemory(snapshots)
        index(models, for: sessionId)
        loadedSessionIDs.insert(sessionId)
    }

    /// Upserts one message into memory and schedules a disk write.
    public func upsert(
        sessionId: String,
        message: Domain.SessionMessage,
        streamingTurnUserMessageId: String? = nil,
        createdAtFallback: Date = Date()
    ) {
        let snapshot = snapshot(
            for: message,
            sessionId: sessionId,
            streamingTurnUserMessageId: streamingTurnUserMessageId,
            fallback: createdAtFallback
        )
        let newModels = entityStore.putMemory([snapshot])
        if let cache {
            let previousWriteTask = pendingWriteTask
            pendingWriteTask = Task { @MainActor in
                await previousWriteTask?.value
                do {
                    try await cache.put(SessionMessageEntity.self, snapshots: [snapshot])
                } catch {
                    Logger.error("disk write failed: \(error)")
                }
            }
        }
        if loadedSessionIDs.contains(sessionId) {
            upsertIntoSessionIndex(newModels, for: sessionId)
        }
    }

    /// Deletes all cached messages for a session.
    public func deleteSessionMessages(sessionId: String) async throws {
        await pendingWriteTask?.value
        let models = try await entityStore.getFromDisk(
            predicate: #Predicate<SessionMessageEntity> {
                $0.sessionId == sessionId
            }
        )
        let ids = Set(models.map(\.id))
        entityStore.delete(ids)
        loadedSessionIDs.remove(sessionId)
        messageIDsBySessionID[sessionId] = nil
    }

    /// Deletes cached messages by id.
    public func delete(ids: Set<String>) {
        entityStore.delete(ids)
        for sessionId in Array(messageIDsBySessionID.keys) {
            messageIDsBySessionID[sessionId]?.removeAll { ids.contains($0) }
        }
    }

    /// Clears every cached message and session index from memory and disk.
    public func deleteAll() async throws {
        await pendingWriteTask?.value
        loadedSessionIDs.removeAll()
        messageIDsBySessionID.removeAll()
        try await entityStore.deleteAll()
    }

    private func modelsFromMemory(sessionId: String) -> [SessionMessageWrapper]? {
        guard loadedSessionIDs.contains(sessionId),
              let ids = messageIDsBySessionID[sessionId] else {
            return nil
        }

        return ids.compactMap { entityStore[$0] }
    }

    private func index(_ models: [SessionMessageWrapper], for sessionId: String) {
        messageIDsBySessionID[sessionId] = models
            .filter { $0.sessionId == sessionId }
            .sorted { $0.createdAt < $1.createdAt }
            .map(\.id)
    }

    private func upsertIntoSessionIndex(_ models: [SessionMessageWrapper], for sessionId: String) {
        var ids = messageIDsBySessionID[sessionId] ?? []
        for model in models where model.sessionId == sessionId {
            ids.removeAll { $0 == model.id }
            ids.append(model.id)
        }
        messageIDsBySessionID[sessionId] = ids.sorted { lhs, rhs in
            guard let left = entityStore[lhs], let right = entityStore[rhs] else {
                return lhs < rhs
            }
            return left.createdAt < right.createdAt
        }
    }

    private func snapshots(
        for messages: [Domain.SessionMessage],
        sessionId: String
    ) -> [SessionMessageData] {
        messages.map {
            snapshot(for: $0, sessionId: sessionId, fallback: Date())
        }
    }

    private func snapshot(
        for message: Domain.SessionMessage,
        sessionId: String,
        streamingTurnUserMessageId: String? = nil,
        fallback: Date
    ) -> SessionMessageData {
        SessionMessageData(
            sessionId: sessionId,
            createdAt: message.createdAt ?? fallback,
            message: message,
            streamingTurnUserMessageId: streamingTurnUserMessageId
        )
    }

    private func deleteUnreadableSessionCache(sessionId: String) async throws {
        guard let cache else { return }

        let predicate = #Predicate<SessionMessageEntity> {
            $0.sessionId == sessionId
        }
        try await cache.runBackgroundTask { context in
            try context.delete(model: SessionMessageEntity.self, where: predicate)
        }
        loadedSessionIDs.remove(sessionId)
        messageIDsBySessionID[sessionId] = nil
    }

    private func encodedSize(_ message: Domain.SessionMessage) -> Int {
        (try? JSONEncoder().encode(message).count) ?? 0
    }
}
