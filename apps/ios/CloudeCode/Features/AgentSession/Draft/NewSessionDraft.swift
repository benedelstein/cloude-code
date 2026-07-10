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

    private(set) var selectedModel: ModelPickerState.SelectedModel?
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
        selectedModel = preferences.lastSelectedModel.map {
            ModelPickerState.SelectedModel(
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
        resolveSelectedModel()
    }

    /// Whether the draft selection has been validated against the loaded catalog.
    var isModelSelectionReady: Bool {
        guard let selectedModel,
              let provider = modelPicker.modelCatalog?.providers.first(where: {
                  $0.providerId == selectedModel.providerId
              }),
              provider.isSelectable,
              provider.models.contains(where: {
                  $0.id == selectedModel.modelId && $0.selectable
              }) else {
            return false
        }
        guard let effortId = selectedModel.effortId else {
            return true
        }
        return provider.efforts.contains { $0.id == effortId && $0.selectable }
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

    /// Selects a model and stores it as the default for future drafts.
    func selectModel(provider: ProviderCatalogEntry, model: ProviderCatalogModel) {
        let selection = modelPicker.selection(
            provider: provider,
            model: model,
            preservingEffortFrom: selectedModel
        )
        selectedModel = selection
        let effort = provider.efforts.first { $0.id == selection.effortId }
        preferences.persistModel(provider: provider, model: model, effort: effort)
    }

    /// Selects an effort level and stores it as the default for future drafts.
    func selectEffort(provider: ProviderCatalogEntry, effort: ProviderCatalogEffort) {
        guard let selection = modelPicker.selection(
            provider: provider,
            effort: effort,
            for: selectedModel
        ), let model = provider.models.first(where: { $0.id == selection.modelId }) else {
            return
        }
        selectedModel = selection
        preferences.persistModel(provider: provider, model: model, effort: effort)
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
        guard let selectedModel, isModelSelectionReady else {
            throw DraftError.modelRequired
        }

        let content = content.trimmingCharacters(in: .whitespacesAndNewlines)
        let initialMessage = CreateSessionInitialMessage(
            content: content.isEmpty ? nil : content,
            attachmentIds: attachmentIds.isEmpty ? nil : attachmentIds
        )
        let branch = selectedBranch == selectedRepo.defaultBranch ? nil : selectedBranch
        let request = CreateSessionRequest(
            repoId: selectedRepo.id,
            settings: AgentSettingsInput(
                provider: selectedModel.providerId,
                model: selectedModel.modelId,
                effort: selectedModel.effortId
            ),
            branch: branch,
            initialMessage: initialMessage
        )
        return try await sessionsAPI.createSession(request)
    }

    private func resolveSelectedModel() {
        guard let catalog = modelPicker.modelCatalog else {
            return
        }
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

private enum DraftError: LocalizedError {
    case repoRequired
    case modelRequired

    var errorDescription: String? {
        switch self {
        case .repoRequired:
            "Select a repository before sending."
        case .modelRequired:
            "Wait for the model catalog before sending."
        }
    }
}

private extension ProviderCatalogEntry {
    var isSelectable: Bool {
        connected && !requiresReauth
    }
}
