@testable import API
import CoreAPI
import Foundation
import Testing

@Suite("WebSocket token cache")
struct WebSocketTokenCacheTests {
    @Test func resetForcesTheNextTokenFetch() async throws {
        let fetchCount = FetchCount()
        let cache = WebSocketTokenCache {
            let count = await fetchCount.increment()
            return WebSocketToken(
                token: "token-\(count)",
                expiresAt: ISODateTimeString("2099-01-01T00:00:00.000Z")
            )
        }

        #expect(try await cache.token().token == "token-1")
        #expect(try await cache.token().token == "token-1")

        await cache.reset()

        #expect(try await cache.token().token == "token-2")
    }

    @Test func resetPreventsAnOlderFetchFromRepopulatingTheCache() async throws {
        let fetchCount = FetchCount()
        let firstFetchGate = FetchGate()
        let cache = WebSocketTokenCache {
            let count = await fetchCount.increment()
            if count == 1 {
                await firstFetchGate.wait()
            }
            return WebSocketToken(
                token: "token-\(count)",
                expiresAt: ISODateTimeString("2099-01-01T00:00:00.000Z")
            )
        }
        let firstFetch = Task {
            try await cache.token()
        }
        while !(await firstFetchGate.didStart) {
            await Task.yield()
        }

        await cache.reset()
        await firstFetchGate.resume()
        #expect(try await firstFetch.value.token == "token-1")

        #expect(try await cache.token().token == "token-2")
    }
}

private actor FetchCount {
    private var count = 0

    func increment() -> Int {
        count += 1
        return count
    }
}

private actor FetchGate {
    private(set) var didStart = false
    private var continuation: CheckedContinuation<Void, Never>?

    func wait() async {
        didStart = true
        await withCheckedContinuation { continuation = $0 }
    }

    func resume() {
        continuation?.resume()
        continuation = nil
    }
}
