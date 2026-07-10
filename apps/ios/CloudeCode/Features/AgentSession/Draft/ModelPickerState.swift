import API
import CoreAPI
import Foundation

/// Owns the model catalog and the model selection used by a session composer.
@MainActor
@Observable
final class ModelPickerState {
    struct SelectedModel: Equatable {
        let providerId: ProviderId
        let modelId: String
        let displayName: String
        let effortId: String?
        let effortDisplayName: String?
    }

    private let modelsAPI: any ModelsAPIProviding
    private let preferences: NewSessionPreferences

    private(set) var modelCatalog: ModelsResponse?
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    var selectedModel: SelectedModel?

    init(modelsAPI: any ModelsAPIProviding, preferences: NewSessionPreferences) {
        self.modelsAPI = modelsAPI
        self.preferences = preferences
        selectedModel = preferences.lastSelectedModel.map {
            SelectedModel(
                providerId: ProviderId(rawValue: $0.providerId),
                modelId: $0.modelId,
                displayName: $0.displayName,
                effortId: $0.effortId,
                effortDisplayName: $0.effortDisplayName
            )
        }
    }

    /// Loads the available model catalog and resolves the persisted selection.
    func load() async {
        guard !isLoading else {
            return
        }
        isLoading = true
        errorMessage = nil
        defer {
            isLoading = false
        }

        do {
            let catalog = try await modelsAPI.models()
            modelCatalog = catalog
            resolveSelectedModel(with: catalog)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Selects a model and optionally stores it as the new-session default.
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

    /// Selects an effort level and optionally stores it as the new-session default.
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

    /// Selects settings reported by an existing session without changing new-session preferences.
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
}

private extension ProviderCatalogEntry {
    var isSelectable: Bool {
        connected && !requiresReauth
    }
}
