import Domain
import Foundation
import SwiftData
import XCTest
@testable import Entities

@MainActor
final class SessionClientStateStoreTests: XCTestCase {
    private func makeCache() throws -> Cache {
        try Cache(container: ModelContainerFactory().make(inMemory: true))
    }

    func testSnapshotRoundTripsThroughStore() async throws {
        let cache = try makeCache()
        let store = SessionClientStateStore(cache: cache)
        let snapshot = testSessionClientStateSnapshot("s1")

        store.save(snapshot)
        _ = try await pollUntil {
            try await cache.count(SessionClientStateEntity.self) == 1 ? true : nil
        }
        let restoredStore = SessionClientStateStore(cache: cache)
        let restored = await restoredStore.snapshot(sessionId: "s1")

        XCTAssertEqual(restored, snapshot)
    }

    func testReplacementClearsOptionalValues() async throws {
        let cache = try makeCache()
        let store = SessionClientStateStore(cache: cache)
        store.save(testSessionClientStateSnapshot("s1"))
        store.save(testSessionClientStateSnapshot(
            "s1",
            repoFullName: nil,
            sessionSetupRun: nil,
            pullRequest: nil,
            pushedBranch: nil,
            baseBranch: nil,
            isResponding: false
        ))

        let restored = try await pollUntil {
            let snapshots = try await cache.fetch(SessionClientStateEntity.self, ids: ["s1"])
            guard let snapshot = snapshots.first,
                  snapshot.repoFullName == nil,
                  snapshot.sessionSetupRun == nil,
                  snapshot.pullRequest == nil,
                  snapshot.pushedBranch == nil,
                  snapshot.baseBranch == nil,
                  !snapshot.isResponding else {
                return nil
            }
            return snapshot
        }

        XCTAssertEqual(restored.status, .ready)
    }

    func testUnreadableRowIsDeleted() async throws {
        let cache = try makeCache()
        try await cache.put(
            SessionClientStateEntity.self,
            snapshots: [testSessionClientStateSnapshot("s1")]
        )
        let descriptor = FetchDescriptor<SessionClientStateEntity>(
            predicate: SessionClientStateEntity.singleItemPredicate("s1")
        )
        try await cache.runBackgroundTask { context in
            guard let row = try context.fetch(descriptor).first else {
                throw CocoaError(.fileReadUnknown)
            }
            row.snapshotData = Data([0xFF])
        }
        let store = SessionClientStateStore(cache: cache)

        let restored = await store.snapshot(sessionId: "s1")

        XCTAssertNil(restored)
        _ = try await pollUntil {
            let count = try await cache.count(
                SessionClientStateEntity.self,
                predicate: SessionClientStateEntity.singleItemPredicate("s1")
            )
            return count == 0 ? true : nil
        }
    }

    func testDeleteAndDeleteAllClearSnapshots() async throws {
        let cache = try makeCache()
        let store = SessionClientStateStore(cache: cache)
        store.save(testSessionClientStateSnapshot("s1"))
        store.save(testSessionClientStateSnapshot("s2"))
        _ = try await pollUntil {
            try await cache.count(SessionClientStateEntity.self) == 2 ? true : nil
        }

        store.delete(sessionId: "s1")
        _ = try await pollUntil {
            try await cache.count(SessionClientStateEntity.self) == 1 ? true : nil
        }
        try await store.deleteAll()

        let count = try await cache.count(SessionClientStateEntity.self)
        XCTAssertEqual(count, 0)
    }

    func testExistingStoreReopensWithAdditiveClientStateModel() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("SessionClientStateStoreTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        defer {
            try? FileManager.default.removeItem(at: directory)
        }
        let storeURL = directory.appendingPathComponent("CloudeCode.store")
        try createPreviousModelStore(at: storeURL)

        let schema = Schema(versionedSchema: CurrentSchema.self)
        let configuration = ModelConfiguration(
            "Compatibility",
            schema: schema,
            url: storeURL,
            cloudKitDatabase: .none
        )
        let container = try ModelContainer(
            for: schema,
            migrationPlan: MigrationPlan.self,
            configurations: [configuration]
        )
        let context = ModelContext(container)

        XCTAssertEqual(try context.fetchCount(FetchDescriptor<UserEntity>()), 1)
        context.insert(SessionClientStateEntity(testSessionClientStateSnapshot("s1")))
        try context.save()
        XCTAssertEqual(
            try context.fetchCount(FetchDescriptor<SessionClientStateEntity>()),
            1
        )
    }

    private func createPreviousModelStore(at url: URL) throws {
        let schema = Schema(
            [
                UserEntity.self,
                SessionSummaryEntity.self,
                SessionMessageEntity.self,
                RepoEnvironmentEntity.self
            ],
            version: SchemaV1.versionIdentifier
        )
        let configuration = ModelConfiguration(
            "Compatibility",
            schema: schema,
            url: url,
            cloudKitDatabase: .none
        )
        let container = try ModelContainer(
            for: schema,
            configurations: [configuration]
        )
        let context = ModelContext(container)
        context.insert(UserEntity(testUser("u1")))
        try context.save()
    }
}
