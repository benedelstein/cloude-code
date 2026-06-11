import Domain
import XCTest
@testable import Entities

final class CacheTests: XCTestCase {
    private func makeCache() throws -> Cache {
        try Cache(container: ModelContainerFactory().make(inMemory: true))
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

    func testResetClearsAllRows() async throws {
        let cache = try makeCache()

        try await cache.put(UserEntity.self, snapshots: [testUser("u1")])
        try await cache.reset()
        let fetched = try await cache.fetch(UserEntity.self, ids: ["u1"])

        XCTAssertTrue(fetched.isEmpty)
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
            testSessionSummary("s1", title: "Draft"),
        ])
        try await cache.put(SessionSummaryEntity.self, snapshots: [
            testSessionSummary("s1", title: "Updated"),
        ])

        let fetched = try await cache.fetch(SessionSummaryEntity.self, ids: ["s1"])
        XCTAssertEqual(fetched.count, 1)
        XCTAssertEqual(fetched[0].title, "Updated")
        XCTAssertEqual(fetched[0].pullRequest?.number, 1)

        try await cache.delete(SessionSummaryEntity.self, ids: ["s1"])
        let afterDelete = try await cache.fetch(SessionSummaryEntity.self, ids: ["s1"])
        XCTAssertTrue(afterDelete.isEmpty)
    }
}
