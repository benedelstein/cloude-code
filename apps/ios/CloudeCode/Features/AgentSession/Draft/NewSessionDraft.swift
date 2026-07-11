import API
import CoreAPI
import Foundation

@MainActor
@Observable
final class NewSessionDraft {
    struct SelectedRepo: Equatable, Identifiable {
        let id: Int
        let fullName: String
        let defaultBranch: String
    }

    /// Repo selection with the branch nested inside it, so clearing or replacing
    /// the repo can never leave a stale branch behind.
    struct RepoSelection: Equatable {
        let repo: SelectedRepo
        var branch: String
    }

    private let sessionsAPI: any SessionsAPIProviding
    private let reposAPI: any ReposAPIProviding
    private let preferences: NewSessionPreferences
    private var branchesByRepoID: [Int: [Branch]] = [:]

    private(set) var repos: [Repo] = []
    private(set) var isLoading = false
    private(set) var isLoadingRepos = false
    private(set) var errorMessage: String?

    var repoSelection: RepoSelection?

    var selectedRepo: SelectedRepo? {
        repoSelection?.repo
    }

    var selectedBranch: String? {
        repoSelection?.branch
    }

    init(
        sessionsAPI: any SessionsAPIProviding,
        reposAPI: any ReposAPIProviding,
        preferences: NewSessionPreferences
    ) {
        self.sessionsAPI = sessionsAPI
        self.reposAPI = reposAPI
        self.preferences = preferences
        repoSelection = preferences.lastSelectedRepo.map {
            RepoSelection(
                repo: SelectedRepo(
                    id: $0.id,
                    fullName: $0.fullName,
                    defaultBranch: $0.defaultBranch
                ),
                branch: $0.defaultBranch
            )
        }
    }

    /// Loads repository defaults for the draft screen.
    func load() async {
        guard !isLoading else {
            return
        }
        isLoading = true
        isLoadingRepos = true
        errorMessage = nil
        defer {
            isLoading = false
            isLoadingRepos = false
        }

        do {
            let reposResponse = try await reposAPI.listRepos(limit: 50, cursor: nil)
            repos = reposResponse.repos
            resolveSelectedRepo(with: reposResponse.repos)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Searches repositories by query, falling back to the first loaded page when empty.
    func searchRepos(query: String, limit: Int = 50) async throws -> [Repo] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else {
            if repos.isEmpty {
                let response = try await reposAPI.listRepos(limit: limit, cursor: nil)
                repos = response.repos
            }
            return repos
        }
        return try await reposAPI.searchRepos(query: trimmedQuery, limit: limit).repos
    }

    /// Returns the branches cached for a repository during this draft session.
    func cachedBranches(repoId: Int) -> [Branch]? {
        branchesByRepoID[repoId]
    }

    /// Loads and caches the branches available for a repository.
    func branches(repoId: Int, limit: Int = 100) async throws -> [Branch] {
        if let cachedBranches = branchesByRepoID[repoId] {
            return cachedBranches
        }

        let branches = try await reposAPI.branches(repoId: repoId, limit: limit, cursor: nil).branches
        branchesByRepoID[repoId] = branches
        return branches
    }

    /// Selects a repository and branch, resetting to the repository default when no branch is supplied.
    func selectRepo(_ repo: Repo, branch: String? = nil) {
        repoSelection = RepoSelection(
            repo: SelectedRepo(
                id: repo.id,
                fullName: repo.fullName,
                defaultBranch: repo.defaultBranch
            ),
            branch: branch ?? repo.defaultBranch
        )
        preferences.persistRepo(repo)
    }

    /// Selects a branch for the current repository.
    func selectBranch(_ branch: String) {
        repoSelection?.branch = branch
    }

    /// Builds and sends the create-session request for this draft.
    func createSession(
        content: String,
        attachmentIds: [String],
        model: ModelSelection
    ) async throws -> CreateSessionResponse {
        guard let repoSelection else {
            throw DraftError.repoRequired
        }

        let content = content.trimmingCharacters(in: .whitespacesAndNewlines)
        let initialMessage = CreateSessionInitialMessage(
            content: content.isEmpty ? nil : content,
            attachmentIds: attachmentIds.isEmpty ? nil : attachmentIds
        )
        let branch = repoSelection.branch == repoSelection.repo.defaultBranch ? nil : repoSelection.branch
        let request = CreateSessionRequest(
            repoId: repoSelection.repo.id,
            settings: AgentSettingsInput(
                provider: model.providerId,
                model: model.modelId,
                effort: model.effortId
            ),
            branch: branch,
            initialMessage: initialMessage
        )
        return try await sessionsAPI.createSession(request)
    }

    private func resolveSelectedRepo(with loadedRepos: [Repo]) {
        if let repoSelection,
           let repo = loadedRepos.first(where: { $0.id == repoSelection.repo.id }) {
            // A restored selection's branch is just the default branch we
            // persisted; follow the freshly loaded default in case it changed.
            let branch = repoSelection.branch == repoSelection.repo.defaultBranch
                ? repo.defaultBranch
                : repoSelection.branch
            selectRepo(repo, branch: branch)
            return
        }

        repoSelection = nil
    }
}

private enum DraftError: LocalizedError {
    case repoRequired

    var errorDescription: String? {
        switch self {
        case .repoRequired:
            "Select a repository before sending."
        }
    }
}
