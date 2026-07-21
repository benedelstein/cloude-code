import Domain
import Foundation
import XCTest
@testable import Entities

@MainActor
final class SessionMessageStoreTests: XCTestCase {
    private func makeCache() throws -> Cache {
        try Cache(container: ModelContainerFactory().make(inMemory: true))
    }

    func testReplaceCachesMessagesSortedByCreatedAt() async throws {
        let cache = try makeCache()
        let store = SessionMessageStore(cache: cache)

        try await store.replace(sessionId: "s1", with: [
            testSessionMessage("m2", createdAt: "2026-06-11T00:00:02.000Z"),
            testSessionMessage("m1", createdAt: "2026-06-11T00:00:01.000Z"),
        ])

        let messages = try await store.messages(sessionId: "s1")

        XCTAssertEqual(messages.map(\.id), ["m1", "m2"])
    }

    func testReplacePrunesStaleSessionRows() async throws {
        let cache = try makeCache()
        let store = SessionMessageStore(cache: cache)

        try await store.replace(sessionId: "s1", with: [
            testSessionMessage("m1", text: "Original", createdAt: "2026-06-11T00:00:01.000Z"),
            testSessionMessage("stale", createdAt: "2026-06-11T00:00:02.000Z"),
        ])
        try await store.replace(sessionId: "s1", with: [
            testSessionMessage("m1", text: "Updated", createdAt: "2026-06-11T00:00:03.000Z"),
        ])

        let messages = try await store.messages(sessionId: "s1")
        let staleRows = try await cache.fetch(SessionMessageEntity.self, ids: ["stale"])

        XCTAssertEqual(messages.map(\.id), ["m1"])
        XCTAssertEqual(messages.first?.text, "Updated")
        XCTAssertTrue(staleRows.isEmpty)
    }

    func testUpsertUsesLocalCreatedAtFallbackWhenMetadataIsMissing() async throws {
        let cache = try makeCache()
        let store = SessionMessageStore(cache: cache)
        let fallback = Date(timeIntervalSince1970: 1_782_561_600)

        store.upsert(
            sessionId: "s1",
            message: testSessionMessage("accepted", text: "Accepted"),
            createdAtFallback: fallback
        )

        let persisted = try await pollUntil {
            let rows = try await cache.fetch(SessionMessageEntity.self, ids: ["accepted"])
            return rows.first
        }

        XCTAssertEqual(persisted.createdAt, fallback)
        XCTAssertEqual(persisted.message.text, "Accepted")
    }

    func testUpsertAddsNewMessageToLoadedSessionIndex() async throws {
        let cache = try makeCache()
        let store = SessionMessageStore(cache: cache)

        try await store.replace(sessionId: "s1", with: [
            testSessionMessage("m1", createdAt: "2026-06-11T00:00:01.000Z"),
        ])
        store.upsert(
            sessionId: "s1",
            message: testSessionMessage("m2", createdAt: "2026-06-11T00:00:02.000Z")
        )

        let messages = try await store.messages(sessionId: "s1")

        XCTAssertEqual(messages.map(\.id), ["m1", "m2"])
    }

    func testStreamingTurnIdentityPersistsWithMessage() async throws {
        let cache = try makeCache()
        let store = SessionMessageStore(cache: cache)

        store.upsert(
            sessionId: "s1",
            message: testSessionMessage("partial", text: "In progress"),
            streamingTurnUserMessageId: "user-1"
        )

        _ = try await pollUntil {
            let rows = try await cache.fetch(SessionMessageEntity.self, ids: ["partial"])
            return rows.first
        }
        let restoredStore = SessionMessageStore(cache: cache)
        let records = try await restoredStore.records(sessionId: "s1")

        XCTAssertEqual(records.map(\.message.id), ["partial"])
        XCTAssertEqual(records.first?.streamingTurnUserMessageId, "user-1")
    }

    func testServerReplacePrunesCachedStreamingProjection() async throws {
        let cache = try makeCache()
        let store = SessionMessageStore(cache: cache)
        store.upsert(
            sessionId: "s1",
            message: testSessionMessage("partial", text: "In progress"),
            streamingTurnUserMessageId: "user-1"
        )

        try await store.replace(
            sessionId: "s1",
            with: [testSessionMessage("final", text: "Complete")]
        )
        let records = try await store.records(sessionId: "s1")

        XCTAssertEqual(records.map(\.message.id), ["final"])
        XCTAssertNil(records.first?.streamingTurnUserMessageId)
        let partialRows = try await cache.fetch(SessionMessageEntity.self, ids: ["partial"])
        XCTAssertTrue(partialRows.isEmpty)
    }

    func testMetadataAccessorsReadKnownTimestampFields() {
        let message = Domain.SessionMessage(
            id: "m1",
            role: .assistant,
            parts: [],
            metadata: .object([
                "createdAt": .string("2026-06-11T00:00:01.000Z"),
                "startedAt": .string("2026-06-11T00:00:02.000Z"),
                "endedAt": .string("2026-06-11T00:00:03.000Z"),
                "extra": .bool(true),
            ])
        )

        XCTAssertEqual(message.createdAt, Date(timeIntervalSince1970: 1_781_136_001))
        XCTAssertEqual(message.workStartedAt, Date(timeIntervalSince1970: 1_781_136_002))
        XCTAssertEqual(message.workEndedAt, Date(timeIntervalSince1970: 1_781_136_003))
    }

    func testDeleteAllClearsMessagesAndLoadedSessionIndex() async throws {
        let store = SessionMessageStore()
        try await store.replace(sessionId: "s1", with: [testSessionMessage("m1")])

        try await store.deleteAll()

        XCTAssertTrue(store.loadedSessionIDs.isEmpty)
        let messages = try await store.messages(sessionId: "s1")
        XCTAssertTrue(messages.isEmpty)
    }
}
