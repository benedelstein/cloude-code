import Domain
import Foundation
import XCTest

func testUser(_ id: String, name: String? = nil) -> Domain.User {
    Domain.User(id: id, login: "login-\(id)", name: name, avatarUrl: nil)
}

/// Polls until `condition` returns a value, for asserting on background
/// persistence that EntityStore kicks off in unstructured Tasks.
func pollUntil<T: Sendable>(
    timeout: TimeInterval = 2,
    _ condition: @Sendable () async throws -> T?
) async throws -> T {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if let value = try await condition() {
            return value
        }
        try await Task.sleep(nanoseconds: 10_000_000)
    }
    XCTFail("timed out waiting for condition")
    throw CancellationError()
}
