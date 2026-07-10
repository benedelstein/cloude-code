import API
import CoreAPI
import Foundation

/// Loads the model catalog and constructs normalized picker selections.
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

    private(set) var modelCatalog: ModelsResponse?
    private(set) var isLoading = false
    private(set) var errorMessage: String?

    init(modelsAPI: any ModelsAPIProviding) {
        self.modelsAPI = modelsAPI
    }

    /// Loads the available model catalog.
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
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Builds a selection, preserving the current effort when the provider supports it.
    func selection(
        provider: ProviderCatalogEntry,
        model: ProviderCatalogModel,
        preservingEffortFrom selectedModel: SelectedModel?
    ) -> SelectedModel {
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

        return SelectedModel(
            providerId: provider.providerId,
            modelId: model.id,
            displayName: model.displayName,
            effortId: effort?.id,
            effortDisplayName: effort?.displayName
        )
    }

    /// Builds an effort selection for the selected model when the effort is valid.
    func selection(
        provider: ProviderCatalogEntry,
        effort: ProviderCatalogEffort,
        for selectedModel: SelectedModel?
    ) -> SelectedModel? {
        guard effort.selectable,
              let selectedModel,
              selectedModel.providerId == provider.providerId,
              provider.models.contains(where: { $0.id == selectedModel.modelId }) else {
            return nil
        }

        return SelectedModel(
            providerId: selectedModel.providerId,
            modelId: selectedModel.modelId,
            displayName: selectedModel.displayName,
            effortId: effort.id,
            effortDisplayName: effort.displayName
        )
    }
}
