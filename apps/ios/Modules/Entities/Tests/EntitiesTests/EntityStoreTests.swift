import Domain
import XCTest
@testable import Entities

/// Records network fetches made through the store's getAPI closure.
private actor NetworkRecorder {
    private(set) var fetches: [Set<String>] = []

    func record(_ ids: Set<String>) {
        fetches.append(ids)
    }
}

@MainActor
final class EntityStoreTests: XCTestCase {
    private func makeCache() throws -> Cache {
        try Cache(container: ModelContainerFactory().make(inMemory: true))
    }

    func testPutMemoryPreservesReferenceIdentity() {
        let store = UserStore()

        let first = store.putMemory([testUser("u1", name: "Ada")])
        let second = store.putMemory([testUser("u1", name: "Grace")])

        XCTAssertEqual(first.count, 1)
        XCTAssertEqual(second.count, 1)
        XCTAssertTrue(first[0] === second[0], "same id must map to the same instance")
        XCTAssertEqual(first[0].name, "Grace", "existing instance must be updated in place")
    }

    func testGetReturnsMemoryHitWithoutTouchingNetwork() async throws {
        let recorder = NetworkRecorder()
        let store = try UserStore(cache: makeCache()) { ids in
            await recorder.record(ids)
            return []
        }
        store.putMemory([testUser("u1")])

        let results = try await store.get(["u1"])

        XCTAssertEqual(results.map(\.id), ["u1"])
        let fetches = await recorder.fetches
        XCTAssertTrue(fetches.isEmpty)
    }

    func testGetFallsThroughDiskThenNetworkAndPersists() async throws {
        let cache = try makeCache()
        try await cache.put(UserEntity.self, snapshots: [testUser("onDisk")])
        let recorder = NetworkRecorder()
        let store = UserStore(cache: cache) { ids in
            await recorder.record(ids)
            return ids.map { testUser($0, name: "from network") }
        }

        let results = try await store.get(["onDisk", "remoteOnly"])

        XCTAssertEqual(Set(results.map(\.id)), ["onDisk", "remoteOnly"])
        let fetches = await recorder.fetches
        XCTAssertEqual(fetches, [["remoteOnly"]], "disk hits must not be re-fetched")

        // Network results flow back to disk via putSnapshotsToDisk's background task.
        let persisted = try await pollUntil {
            let snapshots = try await cache.fetch(UserEntity.self, ids: ["remoteOnly"])
            return snapshots.isEmpty ? nil : snapshots
        }
        XCTAssertEqual(persisted.map(\.name), ["from network"])
    }

    func testScopesLimitCascade() async throws {
        let recorder = NetworkRecorder()
        let store = try UserStore(cache: makeCache()) { ids in
            await recorder.record(ids)
            return ids.map { testUser($0) }
        }

        let results = try await store.get(["u1"], scopes: [.memory, .disk])

        XCTAssertTrue(results.isEmpty)
        let fetches = await recorder.fetches
        XCTAssertTrue(fetches.isEmpty, "network scope was excluded")
    }

    func testSavePersistsCurrentModelState() async throws {
        let cache = try makeCache()
        let store = UserStore(cache: cache)
        let model = store.putMemory([testUser("u1", name: "Ada")])[0]

        model.name = "Countess Ada"
        store.save([model])

        let persisted = try await pollUntil {
            let snapshots = try await cache.fetch(UserEntity.self, ids: ["u1"])
            return snapshots.first?.name == "Countess Ada" ? snapshots : nil
        }
        XCTAssertEqual(persisted.count, 1)
    }

    func testLoadPullsAllRowsIntoMemory() async throws {
        let cache = try makeCache()
        try await cache.put(UserEntity.self, snapshots: [testUser("u1"), testUser("u2")])
        let store = UserStore(cache: cache)

        let loaded = try await store.load()

        XCTAssertEqual(Set(loaded.map(\.id)), ["u1", "u2"])
        XCTAssertNotNil(store["u1"])
        XCTAssertNotNil(store["u2"])
    }

    func testGetFromDiskWithPredicateSortAndLimit() async throws {
        let cache = try makeCache()
        try await cache.put(UserEntity.self, snapshots: [
            testUser("u1", name: "Ada"),
            testUser("u2", name: "Grace"),
            testUser("u3"),
        ])
        let store = UserStore(cache: cache)

        let named = try await store.getFromDisk(
            predicate: #Predicate { $0.name != nil },
            sortBy: [SortDescriptor(\.login, order: .reverse)],
            limit: 1
        )

        XCTAssertEqual(named.map(\.id), ["u2"], "reverse login sort with limit 1")
    }

    func testCount() async throws {
        let cache = try makeCache()
        try await cache.put(UserEntity.self, snapshots: [
            testUser("u1", name: "Ada"),
            testUser("u2"),
        ])
        let store = UserStore(cache: cache)

        let total = try await store.count()
        let named = try await store.count(predicate: #Predicate { $0.name != nil })

        XCTAssertEqual(total, 2)
        XCTAssertEqual(named, 1)
    }

    func testDeleteRemovesFromMemoryAndDisk() async throws {
        let cache = try makeCache()
        try await cache.put(UserEntity.self, snapshots: [testUser("u1")])
        let store = UserStore(cache: cache)
        _ = try await store.get(["u1"], scopes: [.memory, .disk])
        XCTAssertNotNil(store["u1"])

        store.delete(["u1"])

        XCTAssertNil(store["u1"])
        _ = try await pollUntil {
            let snapshots = try await cache.fetch(UserEntity.self, ids: ["u1"])
            return snapshots.isEmpty ? true : nil
        }
    }

    func testDeleteAllClearsMemoryAndDisk() async throws {
        let cache = try makeCache()
        try await cache.put(UserEntity.self, snapshots: [testUser("u1")])
        let store = UserStore(cache: cache)
        _ = try await store.get(["u1"], scopes: [.memory, .disk])

        try await store.deleteAll()

        XCTAssertNil(store["u1"])
        let persisted = try await cache.fetch(UserEntity.self, ids: ["u1"])
        XCTAssertTrue(persisted.isEmpty)
    }
}
