import API
import CoreAPI
import Foundation

@MainActor
@Observable
final class NewSessionDraft {
    struct SelectedModel: Equatable {
        let providerId: ProviderId
        let modelId: String
        let displayName: String
    }

    struct SelectedRepo: Equatable, Identifiable {
        let id: Int
        let fullName: String
        let defaultBranch: String
    }

    private let sessionsAPI: any SessionsAPIProviding
    private let reposAPI: any ReposAPIProviding
    private let modelsAPI: any ModelsAPIProviding
    private let preferences: NewSessionPreferences

    private(set) var catalog: ModelsResponse?
    private(set) var repos: [Repo] = []
    private(set) var isLoading = false
    private(set) var isLoadingRepos = false
    private(set) var isLoadingCatalog = false
    private(set) var errorMessage: String?

    var selectedModel: SelectedModel?
    var selectedRepo: SelectedRepo?
    var selectedBranch: String?

    init(
        sessionsAPI: any SessionsAPIProviding,
        reposAPI: any ReposAPIProviding,
        modelsAPI: any ModelsAPIProviding,
        preferences: NewSessionPreferences
    ) {
        self.sessionsAPI = sessionsAPI
        self.reposAPI = reposAPI
        self.modelsAPI = modelsAPI
        self.preferences = preferences
        selectedModel = preferences.lastSelectedModel.map {
            SelectedModel(
                providerId: ProviderId(rawValue: $0.providerId),
                modelId: $0.modelId,
                displayName: $0.displayName
            )
        }
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
        isLoadingCatalog = true
        errorMessage = nil
        defer {
            isLoading = false
            isLoadingRepos = false
            isLoadingCatalog = false
        }

        async let catalogResponse = modelsAPI.models()
        async let reposResponse = reposAPI.listRepos(limit: 50, cursor: nil)

        do {
            let (catalog, reposResponse) = try await (catalogResponse, reposResponse)
            self.catalog = catalog
            repos = reposResponse.repos
            resolveSelectedModel(with: catalog)
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

    /// Loads branches for a repository.
    func branches(for repo: Repo, limit: Int = 100) async throws -> [Branch] {
        try await reposAPI.branches(repoId: repo.id, limit: limit, cursor: nil).branches
    }

    /// Selects a model and stores it for future drafts.
    func selectModel(provider: ProviderCatalogEntry, model: ProviderCatalogModel) {
        selectedModel = SelectedModel(
            providerId: provider.providerId,
            modelId: model.id,
            displayName: model.displayName
        )
        preferences.persistModel(provider: provider, model: model)
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
            settings: selectedModel.map {
                AgentSettingsInput(provider: $0.providerId, model: $0.modelId)
            },
            branch: branch,
            initialMessage: initialMessage
        )
        return try await sessionsAPI.createSession(request)
    }

    private func resolveSelectedModel(with catalog: ModelsResponse) {
        if let selectedModel,
           let provider = catalog.providers.first(where: { $0.providerId == selectedModel.providerId }),
           provider.isSelectable,
           provider.models.contains(where: { $0.id == selectedModel.modelId && $0.selectable }) {
            return
        }

        guard let provider = catalog.providers.first(where: \.isSelectable),
              let model = provider.models.first(where: { $0.id == provider.defaultModel && $0.selectable })
                ?? provider.models.first(where: \.selectable) else {
            selectedModel = nil
            return
        }

        selectModel(provider: provider, model: model)
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

private extension ProviderCatalogEntry {
    var isSelectable: Bool {
        connected && !requiresReauth
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
