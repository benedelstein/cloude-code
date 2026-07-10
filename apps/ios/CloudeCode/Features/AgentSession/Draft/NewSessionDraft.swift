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

    private let sessionsAPI: any SessionsAPIProviding
    private let reposAPI: any ReposAPIProviding
    private let preferences: NewSessionPreferences
    private var branchesByRepoID: [Int: [Branch]] = [:]

    let modelPicker: ModelPickerState
    private(set) var repos: [Repo] = []
    private(set) var isLoading = false
    private(set) var isLoadingRepos = false
    private(set) var errorMessage: String?

    var selectedRepo: SelectedRepo?
    var selectedBranch: String?

    init(
        sessionsAPI: any SessionsAPIProviding,
        reposAPI: any ReposAPIProviding,
        modelPicker: ModelPickerState,
        preferences: NewSessionPreferences
    ) {
        self.sessionsAPI = sessionsAPI
        self.reposAPI = reposAPI
        self.modelPicker = modelPicker
        self.preferences = preferences
        selectedRepo = preferences.lastSelectedRepo.map {
            SelectedRepo(
                id: $0.id,
                fullName: $0.fullName,
                defaultBranch: $0.defaultBranch
            )
        }
        selectedBranch = selectedRepo?.defaultBranch
    }

    /// Loads model and repository defaults for the draft screen.
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

        async let modelLoad: Void = modelPicker.load()
        async let reposResponse = reposAPI.listRepos(limit: 50, cursor: nil)

        do {
            let reposResponse = try await reposResponse
            repos = reposResponse.repos
            resolveSelectedRepo(with: reposResponse.repos)
        } catch {
            errorMessage = error.localizedDescription
        }
        await modelLoad
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
        selectedRepo = SelectedRepo(
            id: repo.id,
            fullName: repo.fullName,
            defaultBranch: repo.defaultBranch
        )
        selectedBranch = branch ?? repo.defaultBranch
        preferences.persistRepo(repo)
    }

    /// Selects a branch for the current repository.
    func selectBranch(_ branch: String) {
        selectedBranch = branch
    }

    /// Builds and sends the create-session request for this draft.
    func createSession(content: String, attachmentIds: [String]) async throws -> CreateSessionResponse {
        guard let selectedRepo else {
            throw DraftError.repoRequired
        }

        let content = content.trimmingCharacters(in: .whitespacesAndNewlines)
        let initialMessage = CreateSessionInitialMessage(
            content: content.isEmpty ? nil : content,
            attachmentIds: attachmentIds.isEmpty ? nil : attachmentIds
        )
        let branch = selectedBranch == selectedRepo.defaultBranch ? nil : selectedBranch
        let request = CreateSessionRequest(
            repoId: selectedRepo.id,
            settings: modelPicker.selectedModel.map {
                AgentSettingsInput(
                    provider: $0.providerId,
                    model: $0.modelId,
                    effort: $0.effortId
                )
            },
            branch: branch,
            initialMessage: initialMessage
        )
        return try await sessionsAPI.createSession(request)
    }

    private func resolveSelectedRepo(with loadedRepos: [Repo]) {
        if let selectedRepo,
           let repo = loadedRepos.first(where: { $0.id == selectedRepo.id }) {
            selectRepo(repo, branch: selectedBranch)
            return
        }

        selectedRepo = nil
        selectedBranch = nil
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
