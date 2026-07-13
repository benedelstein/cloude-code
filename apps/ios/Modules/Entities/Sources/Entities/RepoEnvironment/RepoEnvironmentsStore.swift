import Domain
import Foundation
import Observation
import SwiftData

/// Per-repo environment cache backed by `EntityStore`: serves the disk cache
/// first, then reconciles with the server list.
@MainActor
@Observable
public final class RepoEnvironmentsStore {
    @ObservationIgnored private let entityStore: EntityStore<RepoEnvironmentModel>
    @ObservationIgnored private let listAPI: @Sendable (Int) async throws -> [Domain.RepoEnvironment]
    @ObservationIgnored private var loadTasksByRepoID: [Int: Task<Void, Error>] = [:]

    /// Environments per repo id. `nil` for a repo means nothing has been
    /// served yet from either disk or network (drive loading UI off this).
    public private(set) var environmentsByRepoID: [Int: [Domain.RepoEnvironment]] = [:]

    /// Creates a repo environments store.
    ///
    /// - Parameters:
    ///   - cache: Disk cache; pass nil for memory-only behavior.
    ///   - listAPI: Fetches the canonical environment list for a repo id.
    public init(
        cache: Cache? = nil,
        listAPI: @escaping @Sendable (Int) async throws -> [Domain.RepoEnvironment]
    ) {
        entityStore = EntityStore(cache: cache)
        self.listAPI = listAPI
    }

    /// Returns the environments served so far for a repo, or nil when unloaded.
    public func environments(repoId: Int) -> [Domain.RepoEnvironment]? {
        environmentsByRepoID[repoId]
    }

    /// Loads a repo's environments: disk cache first for instant display, then
    /// a network refresh that upserts fresh rows and prunes stale ones.
    /// Concurrent calls for the same repo share one in-flight load.
    public func load(repoId: Int) async throws {
        if let task = loadTasksByRepoID[repoId] {
            try await task.value
            return
        }

        let task = Task { [weak self] in
            defer { self?.loadTasksByRepoID[repoId] = nil }
            try await self?.performLoad(repoId: repoId)
        }
        loadTasksByRepoID[repoId] = task
        try await task.value
    }

    private func performLoad(repoId: Int) async throws {
        if environmentsByRepoID[repoId] == nil {
            let cached = try? await entityStore.getFromDisk(
                predicate: #Predicate<RepoEnvironmentEntity> { $0.repoId == repoId },
                sortBy: [SortDescriptor(\.name)]
            )
            if let cached, !cached.isEmpty {
                environmentsByRepoID[repoId] = cached.map(\.snapshot)
            }
        }

        let fresh = try await listAPI(repoId)
        let freshIDs = Set(fresh.map(\.id))
        let staleIDs = Set((environmentsByRepoID[repoId] ?? []).map(\.id)).subtracting(freshIDs)
        entityStore.delete(staleIDs)
        entityStore.putSnapshotsToDisk(fresh)
        environmentsByRepoID[repoId] = fresh
    }
}
