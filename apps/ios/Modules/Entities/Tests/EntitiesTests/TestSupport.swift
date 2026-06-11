import Domain
import Foundation
import XCTest

func testUser(_ id: String, name: String? = nil) -> Domain.User {
    Domain.User(id: id, login: "login-\(id)", name: name, avatarUrl: nil)
}

func testSessionSummary(
    _ id: String,
    repoId: Int = 1,
    title: String? = "Session"
) -> Domain.SessionSummary {
    Domain.SessionSummary(
        id: id,
        repoId: repoId,
        repoFullName: "owner/repo-\(repoId)",
        title: title,
        archived: false,
        workingState: "idle",
        pushedBranch: "cloude/test",
        pullRequest: .init(url: "https://github.com/owner/repo/pull/1", number: 1, state: "open"),
        createdAt: "2026-06-11T00:00:00.000Z",
        updatedAt: "2026-06-11T00:00:00.000Z",
        lastMessageAt: nil,
        lastAssistantMessageId: nil,
        hasUnread: false
    )
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
