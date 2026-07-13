import Domain
import Foundation
import XCTest
@testable import Entities

@MainActor
final class RepoEnvironmentsStoreTests: XCTestCase {
    private func makeCache() throws -> Cache {
        try Cache(container: ModelContainerFactory().make(inMemory: true))
    }

    func testLoadServesNetworkListAndPersistsIt() async throws {
        let cache = try makeCache()
        let store = RepoEnvironmentsStore(cache: cache) { repoId in
            [testRepoEnvironment("e1", repoId: repoId), testRepoEnvironment("e2", repoId: repoId)]
        }

        XCTAssertNil(store.environments(repoId: 1))

        try await store.load(repoId: 1)

        XCTAssertEqual(store.environments(repoId: 1)?.map(\.id), ["e1", "e2"])
        let persisted = try await pollUntil {
            let rows = try await cache.fetch(RepoEnvironmentEntity.self, ids: ["e1", "e2"])
            return rows.count == 2 ? rows : nil
        }
        XCTAssertEqual(Set(persisted.map(\.id)), ["e1", "e2"])
    }

    func testLoadServesDiskCacheWhenNetworkFails() async throws {
        let cache = try makeCache()
        let seedStore = RepoEnvironmentsStore(cache: cache) { repoId in
            [testRepoEnvironment("e1", repoId: repoId)]
        }
        try await seedStore.load(repoId: 1)
        _ = try await pollUntil {
            let rows = try await cache.fetch(RepoEnvironmentEntity.self, ids: ["e1"])
            return rows.isEmpty ? nil : rows
        }

        let store = RepoEnvironmentsStore(cache: cache) { _ in
            throw URLError(.notConnectedToInternet)
        }

        // The cached list is published before the network refresh throws.
        await XCTAssertThrowsErrorAsync(try await store.load(repoId: 1))
        XCTAssertEqual(store.environments(repoId: 1)?.map(\.id), ["e1"])
    }

    func testLoadPrunesEnvironmentsDeletedOnServer() async throws {
        let cache = try makeCache()
        let responses = ResponseQueue([
            [testRepoEnvironment("e1"), testRepoEnvironment("stale")],
            [testRepoEnvironment("e1")],
        ])
        let store = RepoEnvironmentsStore(cache: cache) { _ in
            await responses.next()
        }

        try await store.load(repoId: 1)
        try await store.load(repoId: 1)

        XCTAssertEqual(store.environments(repoId: 1)?.map(\.id), ["e1"])
        let staleRows = try await cache.fetch(RepoEnvironmentEntity.self, ids: ["stale"])
        XCTAssertTrue(staleRows.isEmpty)
    }

    func testEnvironmentsAreScopedPerRepo() async throws {
        let store = RepoEnvironmentsStore { repoId in
            repoId == 1 ? [testRepoEnvironment("e1", repoId: 1)] : []
        }

        try await store.load(repoId: 1)
        try await store.load(repoId: 2)

        XCTAssertEqual(store.environments(repoId: 1)?.map(\.id), ["e1"])
        XCTAssertEqual(store.environments(repoId: 2), [])
    }
}

/// Serves canned responses in order, repeating the last one.
private actor ResponseQueue {
    private var responses: [[Domain.RepoEnvironment]]

    init(_ responses: [[Domain.RepoEnvironment]]) {
        self.responses = responses
    }

    func next() -> [Domain.RepoEnvironment] {
        responses.count > 1 ? responses.removeFirst() : responses[0]
    }
}

/// Asserts that an async expression throws.
private func XCTAssertThrowsErrorAsync<T>(
    _ expression: @autoclosure () async throws -> T,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        _ = try await expression()
        XCTFail("expected expression to throw", file: file, line: line)
    } catch {}
}
