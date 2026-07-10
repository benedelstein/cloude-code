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
        let effortId: String?
        let effortDisplayName: String?
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
    private var branchesByRepoID: [Int: [Branch]] = [:]

    private(set) var modelCatalog: ModelsResponse?
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
        let lastSelectedModel = preferences.lastSelectedModel
        selectedModel = lastSelectedModel.map {
            SelectedModel(
                providerId: ProviderId(rawValue: $0.providerId),
                modelId: $0.modelId,
                displayName: $0.displayName,
                effortId: $0.effortId,
                effortDisplayName: $0.effortDisplayName
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
            self.modelCatalog = catalog
            repos = reposResponse.repos
            resolveSelectedModel(with: catalog)
            resolveSelectedRepo(with: reposResponse.repos)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Loads the model catalog without fetching repository choices.
    func loadModelCatalog() async {
        guard !isLoadingCatalog else {
            return
        }
        isLoadingCatalog = true
        defer {
            isLoadingCatalog = false
        }

        do {
            let catalog = try await modelsAPI.models()
            modelCatalog = catalog
            resolveSelectedModel(with: catalog)
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

    /// Selects a model and stores it for future drafts.
    func selectModel(
        provider: ProviderCatalogEntry,
        model: ProviderCatalogModel,
        persistsSelection: Bool = true
    ) {
        let selectedEffort: ProviderCatalogEffort? = selectedModel.flatMap { selection in
            guard selection.providerId == provider.providerId else {
                return nil
            }
            return provider.efforts.first {
                $0.id == selection.effortId && $0.selectable
            }
        }
        let effort = selectedEffort
            ?? provider.efforts.first { $0.id == provider.defaultEffort && $0.selectable }
            ?? provider.efforts.first(where: \.selectable)

        selectedModel = SelectedModel(
            providerId: provider.providerId,
            modelId: model.id,
            displayName: model.displayName,
            effortId: effort?.id,
            effortDisplayName: effort?.displayName
        )
        if persistsSelection {
            preferences.persistModel(provider: provider, model: model, effort: effort)
        }
    }

    /// Selects an effort level for the current model and stores it for future drafts.
    func selectEffort(
        provider: ProviderCatalogEntry,
        effort: ProviderCatalogEffort,
        persistsSelection: Bool = true
    ) {
        guard effort.selectable,
              let selectedModel,
              selectedModel.providerId == provider.providerId,
              let model = provider.models.first(where: { $0.id == selectedModel.modelId }) else {
            return
        }

        self.selectedModel = SelectedModel(
            providerId: selectedModel.providerId,
            modelId: selectedModel.modelId,
            displayName: selectedModel.displayName,
            effortId: effort.id,
            effortDisplayName: effort.displayName
        )
        if persistsSelection {
            preferences.persistModel(provider: provider, model: model, effort: effort)
        }
    }

    /// Selects the model reported by an existing session without changing new-session preferences.
    @discardableResult
    func selectSessionModel(providerId: ProviderId, modelId: String, effortId: String) -> Bool {
        guard let provider = modelCatalog?.providers.first(where: { $0.providerId == providerId }),
              let model = provider.models.first(where: { $0.id == modelId }) else {
            return false
        }
        let effort = provider.efforts.first { $0.id == effortId }
        selectedModel = SelectedModel(
            providerId: providerId,
            modelId: modelId,
            displayName: model.displayName,
            effortId: effort?.id,
            effortDisplayName: effort?.displayName
        )
        return true
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
            settings: selectedModel.map {
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

    private func resolveSelectedModel(with catalog: ModelsResponse) {
        if let selectedModel,
           let provider = catalog.providers.first(where: { $0.providerId == selectedModel.providerId }),
           provider.isSelectable,
           let model = provider.models.first(where: { $0.id == selectedModel.modelId && $0.selectable }) {
            selectModel(provider: provider, model: model)
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
