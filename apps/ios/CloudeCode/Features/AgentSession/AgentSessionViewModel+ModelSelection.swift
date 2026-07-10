import CoreAPI
import Domain
import Foundation

extension AgentSessionViewModel {
    var modelSelection: ModelSelection? {
        localModelSelection ?? serverModelSelection
    }

    var isModelSelectionLoading: Bool {
        if isDraftMode {
            return localModelSelection == nil
                && modelCatalogStore.catalog == nil
                && modelCatalogStore.errorMessage == nil
        }
        return clientState.agentSettings.model.isEmpty
    }

    /// Whether the current selection can be sent. Only drafts validate against
    /// the catalog; an existing session's selection comes from the server.
    var isModelSelectionValid: Bool {
        guard isDraftMode else {
            return true
        }
        return localModelSelection?.isValid(in: modelCatalogStore.catalog) == true
    }

    var modelProviderId: ProviderId? {
        if isDraftMode {
            return modelSelection?.providerId
        }
        return clientState.agentSettings.provider.providerId
    }

    /// Model/effort fields to send with the next message when the staged
    /// selection differs from the session's current settings.
    var stagedModelChange: (model: String?, effort: String?)? {
        guard let selectedModel = localModelSelection,
              selectedModel.providerId == modelProviderId else {
            return nil
        }
        let settings = clientState.agentSettings
        return (
            model: selectedModel.modelId == settings.model ? nil : selectedModel.modelId,
            effort: selectedModel.effortId == settings.effort ? nil : selectedModel.effortId
        )
    }

    private var serverModelSelection: ModelSelection? {
        let settings = clientState.agentSettings
        guard let providerId = settings.provider.providerId,
              !settings.model.isEmpty else {
            return nil
        }
        let provider = modelCatalogStore.catalog?.providers.first { $0.providerId == providerId }
        let model = provider?.models.first { $0.id == settings.model }
        let effort = provider?.efforts.first { $0.id == settings.effort }
        let effortId = settings.effort.isEmpty ? nil : settings.effort
        // Client state is authoritative; catalog metadata only improves the labels.
        return ModelSelection(
            providerId: providerId,
            modelId: settings.model,
            displayName: model?.displayName ?? settings.model,
            effortId: effortId,
            effortDisplayName: effort?.displayName ?? effortId
        )
    }

    /// Selects a model for the draft or stages it for the next existing-session message.
    func selectModel(provider: ProviderCatalogEntry, model: ProviderCatalogModel) {
        guard isDraftMode || provider.providerId == modelProviderId else {
            return
        }
        let selection = ModelSelection.selecting(
            provider: provider,
            model: model,
            preservingEffortFrom: modelSelection
        )
        localModelSelection = selection
        persistDraftModelSelection(selection)
    }

    /// Selects an effort for the draft or stages it for the next existing-session message.
    func selectEffort(provider: ProviderCatalogEntry, effort: ProviderCatalogEffort) {
        guard isDraftMode || provider.providerId == modelProviderId else {
            return
        }
        guard let selection = ModelSelection.selecting(
            provider: provider,
            effort: effort,
            for: modelSelection
        ) else {
            return
        }
        localModelSelection = selection
        persistDraftModelSelection(selection)
    }

    /// Re-validates the draft's selection once the catalog is available and
    /// stores the resolved pick as the default for future drafts.
    func resolveDraftModelSelection() {
        guard isDraftMode, let catalog = modelCatalogStore.catalog else {
            return
        }
        localModelSelection = ModelSelection.resolved(from: localModelSelection, in: catalog)
        if let localModelSelection {
            persistDraftModelSelection(localModelSelection)
        }
    }

    private func persistDraftModelSelection(_ selection: ModelSelection) {
        guard isDraftMode else {
            return
        }
        preferences.lastSelectedModel = selection.preferenceValue
    }
}
