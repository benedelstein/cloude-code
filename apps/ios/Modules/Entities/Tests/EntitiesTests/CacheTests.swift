import Domain
import XCTest
@testable import Entities

final class CacheTests: XCTestCase {
    private func makeCache(metadataStore: CacheMetadataStore = CacheMetadataStore()) throws -> Cache {
        try Cache(
            container: ModelContainerFactory().make(inMemory: true),
            metadataStore: metadataStore
        )
    }

    private func makeMetadataStore() throws -> CacheMetadataStore {
        let suiteName = "CacheTests.\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        return CacheMetadataStore(userDefaults: userDefaults)
    }

    func testRoundTrip() async throws {
        let cache = try makeCache()
        let user = testUser("u1", name: "Ada")

        try await cache.put(UserEntity.self, snapshots: [user])
        let fetched = try await cache.fetch(UserEntity.self, ids: ["u1"])

        XCTAssertEqual(fetched, [user])
    }

    func testPutUpdatesExistingRowInsteadOfDuplicating() async throws {
        let cache = try makeCache()

        try await cache.put(UserEntity.self, snapshots: [testUser("u1", name: "Ada")])
        try await cache.put(UserEntity.self, snapshots: [testUser("u1", name: "Countess Ada")])
        let fetched = try await cache.fetch(UserEntity.self, ids: ["u1"])

        XCTAssertEqual(fetched.count, 1, "unique id must update in place, not duplicate")
        XCTAssertEqual(fetched[0].name, "Countess Ada")
    }

    func testFetchesOnlyRequestedIds() async throws {
        let cache = try makeCache()

        try await cache.put(UserEntity.self, snapshots: [testUser("u1"), testUser("u2")])
        let fetched = try await cache.fetch(UserEntity.self, ids: ["u2"])

        XCTAssertEqual(fetched.map(\.id), ["u2"])
    }

    func testDelete() async throws {
        let cache = try makeCache()

        try await cache.put(UserEntity.self, snapshots: [testUser("u1"), testUser("u2")])
        try await cache.delete(UserEntity.self, ids: ["u1"])
        let fetched = try await cache.fetch(UserEntity.self, ids: ["u1", "u2"])

        XCTAssertEqual(fetched.map(\.id), ["u2"])
    }

    func testDeleteAllOnlyClearsTheRequestedEntityTable() async throws {
        let cache = try makeCache()
        let summary = testSessionSummary("s1")

        try await cache.put(UserEntity.self, snapshots: [testUser("u1")])
        try await cache.put(SessionSummaryEntity.self, snapshots: [summary])

        try await cache.deleteAll(UserEntity.self)

        let users = try await cache.fetch(UserEntity.self, ids: ["u1"])
        let summaries = try await cache.fetch(SessionSummaryEntity.self, ids: ["s1"])
        XCTAssertTrue(users.isEmpty)
        XCTAssertEqual(summaries, [summary])
    }

    func testResetClearsAllRows() async throws {
        let cache = try makeCache()

        try await cache.put(UserEntity.self, snapshots: [testUser("u1")])
        try await cache.reset()
        let fetched = try await cache.fetch(UserEntity.self, ids: ["u1"])

        XCTAssertTrue(fetched.isEmpty)
    }

    func testStartResetsCacheAndWritesCurrentVersionWhenMissing() async throws {
        let metadataStore = try makeMetadataStore()
        let cache = try makeCache(metadataStore: metadataStore)

        try await cache.put(UserEntity.self, snapshots: [testUser("u1")])
        XCTAssertNil(metadataStore.cacheVersion())
        try await cache.start()
        let fetched = try await cache.fetch(UserEntity.self, ids: ["u1"])

        XCTAssertTrue(fetched.isEmpty)
        XCTAssertEqual(metadataStore.cacheVersion(), Cache.version)
        XCTAssertEqual(metadataStore.entityVersion(UserEntity.self), UserEntity.cacheVersion)
        XCTAssertEqual(
            metadataStore.entityVersion(SessionSummaryEntity.self),
            SessionSummaryEntity.cacheVersion
        )
    }

    func testStartResetsOutdatedCacheAndWritesCurrentVersion() async throws {
        let metadataStore = try makeMetadataStore()
        metadataStore.setCacheVersion(Cache.version - 1)
        let cache = try makeCache(metadataStore: metadataStore)

        try await cache.put(UserEntity.self, snapshots: [testUser("u1")])
        try await cache.start()
        let fetched = try await cache.fetch(UserEntity.self, ids: ["u1"])

        XCTAssertTrue(fetched.isEmpty)
        XCTAssertEqual(metadataStore.cacheVersion(), Cache.version)
    }

    func testStartKeepsCurrentVersionCache() async throws {
        let metadataStore = try makeMetadataStore()
        metadataStore.setCacheVersion(Cache.version)
        let cache = try makeCache(metadataStore: metadataStore)
        let user = testUser("u1")

        try await cache.put(UserEntity.self, snapshots: [user])
        try await cache.start()
        let fetched = try await cache.fetch(UserEntity.self, ids: ["u1"])

        XCTAssertEqual(fetched, [user])
        XCTAssertEqual(metadataStore.cacheVersion(), Cache.version)
    }

    func testStartDoesNotResetNewerVersionCache() async throws {
        let metadataStore = try makeMetadataStore()
        metadataStore.setCacheVersion(Cache.version + 1)
        let cache = try makeCache(metadataStore: metadataStore)
        let user = testUser("u1")

        try await cache.put(UserEntity.self, snapshots: [user])
        try await cache.start()
        let fetched = try await cache.fetch(UserEntity.self, ids: ["u1"])

        XCTAssertEqual(fetched, [user])
        XCTAssertEqual(metadataStore.cacheVersion(), Cache.version + 1)
    }

    func testStartWritesMissingEntityVersionWithoutResettingRows() async throws {
        let metadataStore = try makeMetadataStore()
        metadataStore.setCacheVersion(Cache.version)
        let cache = try makeCache(metadataStore: metadataStore)
        let user = testUser("u1")

        try await cache.put(UserEntity.self, snapshots: [user])
        try await cache.start()
        let fetched = try await cache.fetch(UserEntity.self, ids: ["u1"])

        XCTAssertEqual(fetched, [user])
        XCTAssertEqual(metadataStore.entityVersion(UserEntity.self), UserEntity.cacheVersion)
    }

    func testStartResetsOnlyOutdatedEntityRows() async throws {
        let metadataStore = try makeMetadataStore()
        metadataStore.setCacheVersion(Cache.version)
        metadataStore.setEntityVersion(UserEntity.cacheVersion - 1, for: UserEntity.self)
        metadataStore.setEntityVersion(
            SessionSummaryEntity.cacheVersion,
            for: SessionSummaryEntity.self
        )
        let cache = try makeCache(metadataStore: metadataStore)
        let summary = testSessionSummary("s1")

        try await cache.put(UserEntity.self, snapshots: [testUser("u1")])
        try await cache.put(SessionSummaryEntity.self, snapshots: [summary])
        try await cache.start()
        let users = try await cache.fetch(UserEntity.self, ids: ["u1"])
        let summaries = try await cache.fetch(SessionSummaryEntity.self, ids: ["s1"])

        XCTAssertTrue(users.isEmpty)
        XCTAssertEqual(summaries, [summary])
        XCTAssertEqual(metadataStore.entityVersion(UserEntity.self), UserEntity.cacheVersion)
        XCTAssertEqual(
            metadataStore.entityVersion(SessionSummaryEntity.self),
            SessionSummaryEntity.cacheVersion
        )
    }

    func testEmptyInputsAreNoOps() async throws {
        let cache = try makeCache()

        try await cache.put(UserEntity.self, snapshots: [])
        let fetched = try await cache.fetch(UserEntity.self, ids: [])

        XCTAssertTrue(fetched.isEmpty)
    }

    func testSessionSummaryRoundTripUpdateAndDelete() async throws {
        let cache = try makeCache()

        try await cache.put(SessionSummaryEntity.self, snapshots: [
            testSessionSummary("s1", title: "Draft", status: "preparing")
        ])
        try await cache.put(SessionSummaryEntity.self, snapshots: [
            testSessionSummary("s1", title: "Updated", status: "setup_failed")
        ])

        let fetched = try await cache.fetch(SessionSummaryEntity.self, ids: ["s1"])
        XCTAssertEqual(fetched.count, 1)
        XCTAssertEqual(fetched[0].title, "Updated")
        XCTAssertEqual(fetched[0].status, "setup_failed")
        XCTAssertEqual(fetched[0].pullRequest?.number, 1)

        try await cache.delete(SessionSummaryEntity.self, ids: ["s1"])
        let afterDelete = try await cache.fetch(SessionSummaryEntity.self, ids: ["s1"])
        XCTAssertTrue(afterDelete.isEmpty)
    }

    func testSessionSummaryProviderRoundTripsKnownNilAndUnknownValues() async throws {
        let cache = try makeCache()
        let summaries = [
            testSessionSummary("known", provider: .claudeCode),
            testSessionSummary("missing", provider: nil),
            testSessionSummary("future", provider: .unknown("future-provider"))
        ]

        try await cache.put(SessionSummaryEntity.self, snapshots: summaries)

        let fetched = try await cache.fetch(
            SessionSummaryEntity.self,
            ids: Set(summaries.map(\.id))
        )
        let providersByID = Dictionary(uniqueKeysWithValues: fetched.map { ($0.id, $0.provider) })
        XCTAssertEqual(providersByID["known"], .some(.claudeCode))
        XCTAssertEqual(providersByID["missing"], .some(nil))
        XCTAssertEqual(providersByID["future"], .some(.unknown("future-provider")))
    }
}
