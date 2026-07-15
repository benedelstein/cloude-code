import API
@testable import CloudeCode
import CoreAPI
import Domain
import Entities
import Foundation
import Testing

@Suite("New session draft environment selection")
@MainActor
struct NewSessionDraftTests {
    @Test func restoredRepoSeedsPersistedEnvironmentBeforeLoading() throws {
        let (preferences, suiteName) = try makePreferences()
        defer { UserDefaults.standard.removePersistentDomain(forName: suiteName) }
        preferences.lastSelectedRepo = .init(
            id: 42,
            fullName: "owner/repo",
            defaultBranch: "main"
        )
        preferences.persistEnvironmentId("environment-2", repoId: 42)

        let draft = makeDraft(preferences: preferences)

        #expect(draft.selectedRepo?.id == 42)
        #expect(draft.selectedEnvironmentId == "environment-2")
    }

    @Test func switchingReposSeedsThatReposPersistedEnvironment() throws {
        let (preferences, suiteName) = try makePreferences()
        defer { UserDefaults.standard.removePersistentDomain(forName: suiteName) }
        preferences.persistEnvironmentId("environment-9", repoId: 9)
        let draft = makeDraft(preferences: preferences)

        draft.selectRepo(Repo(
            id: 9,
            name: "repo",
            fullName: "owner/repo",
            owner: "owner",
            isPrivate: true,
            defaultBranch: "main"
        ))

        #expect(draft.selectedEnvironmentId == "environment-9")
    }

    private func makeDraft(preferences: NewSessionPreferences) -> NewSessionDraft {
        NewSessionDraft(
            sessionsAPI: UnavailableSessionsAPI(),
            reposAPI: UnavailableReposAPI(),
            environmentsStore: RepoEnvironmentsStore { _ in [] },
            preferences: preferences
        )
    }

    private func makePreferences() throws -> (NewSessionPreferences, String) {
        let suiteName = "NewSessionDraftTests.\(UUID().uuidString)"
        let userDefaults = try #require(UserDefaults(suiteName: suiteName))
        return (NewSessionPreferences(userDefaults: userDefaults), suiteName)
    }
}

private struct UnavailableReposAPI: ReposAPIProviding {
    func listRepos(limit: Int?, cursor: String?) async throws -> ListReposResponse {
        throw TestError.unexpectedAPICall
    }

    func searchRepos(query: String, limit: Int?) async throws -> SearchReposResponse {
        throw TestError.unexpectedAPICall
    }

    func branches(repoId: Int, limit: Int?, cursor: String?) async throws -> ListBranchesResponse {
        throw TestError.unexpectedAPICall
    }
}

private struct UnavailableSessionsAPI: SessionsAPIProviding {
    func listSessions(
        repoId: Int?,
        repoCursor: String?,
        sessionCursor: String?,
        repoLimit: Int?,
        sessionLimit: Int?
    ) async throws -> SessionSummaryPage {
        throw TestError.unexpectedAPICall
    }

    func createSession(_ request: CreateSessionRequest) async throws -> CreateSessionResponse {
        throw TestError.unexpectedAPICall
    }

    func session(id: String) async throws -> SessionInfoResponse {
        throw TestError.unexpectedAPICall
    }

    func messages(sessionId: String) async throws -> [SessionMessage] {
        throw TestError.unexpectedAPICall
    }

    func plan(sessionId: String) async throws -> SessionPlanResponse {
        throw TestError.unexpectedAPICall
    }

    func updateTitle(sessionId: String, title: String) async throws -> UpdateSessionTitleResponse {
        throw TestError.unexpectedAPICall
    }

    func createPullRequest(sessionId: String) async throws -> PullRequestResponse {
        throw TestError.unexpectedAPICall
    }

    func pullRequest(sessionId: String) async throws -> PullRequestStatusResponse {
        throw TestError.unexpectedAPICall
    }

    func archive(sessionId: String) async throws {
        throw TestError.unexpectedAPICall
    }

    func delete(sessionId: String) async throws {
        throw TestError.unexpectedAPICall
    }

    func sessionWebSocketToken(sessionId: String) async throws -> WebSocketToken {
        throw TestError.unexpectedAPICall
    }

    func userSessionsWebSocketToken() async throws -> WebSocketToken {
        throw TestError.unexpectedAPICall
    }
}

private enum TestError: Error {
    case unexpectedAPICall
}
