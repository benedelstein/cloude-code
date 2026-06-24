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

    func testMetadataAccessorsReadKnownTimestampFields() {
        let message = Domain.SessionMessage(
            id: "m1",
            role: .assistant,
            parts: [],
            metadata: .object([
                "createdAt": .string("2026-06-11T00:00:01.000Z"),
                "startedAt": .number(1),
                "endedAt": .number(2),
                "extra": .bool(true),
            ])
        )

        XCTAssertEqual(message.createdAtMetadata, "2026-06-11T00:00:01.000Z")
        XCTAssertEqual(message.startedAtMetadata, 1)
        XCTAssertEqual(message.endedAtMetadata, 2)
    }
}
