import CoreAPI
import Domain
import Foundation

/// A normalized provider/model/effort selection shown by the composer picker.
struct ModelSelection: Equatable {
    let providerId: ProviderId
    let modelId: String
    let displayName: String
    let effortId: String?
    let effortDisplayName: String?
}

extension ModelSelection {
    /// Builds a selection, preserving the current effort when the provider supports it.
    static func selecting(
        provider: ProviderCatalogEntry,
        model: ProviderCatalogModel,
        preservingEffortFrom current: ModelSelection?
    ) -> ModelSelection {
        let currentEffort: ProviderCatalogEffort? = current.flatMap { selection in
            guard selection.providerId == provider.providerId else {
                return nil
            }
            return provider.efforts.first {
                $0.id == selection.effortId && $0.selectable
            }
        }
        let effort = currentEffort
            ?? provider.efforts.first { $0.id == provider.defaultEffort && $0.selectable }
            ?? provider.efforts.first(where: \.selectable)

        return ModelSelection(
            providerId: provider.providerId,
            modelId: model.id,
            displayName: model.displayName,
            effortId: effort?.id,
            effortDisplayName: effort?.displayName
        )
    }

    /// Builds an effort selection for the currently selected model when the effort is valid.
    static func selecting(
        provider: ProviderCatalogEntry,
        effort: ProviderCatalogEffort,
        for current: ModelSelection?
    ) -> ModelSelection? {
        guard effort.selectable,
              let current,
              current.providerId == provider.providerId,
              provider.models.contains(where: { $0.id == current.modelId }) else {
            return nil
        }

        return ModelSelection(
            providerId: current.providerId,
            modelId: current.modelId,
            displayName: current.displayName,
            effortId: effort.id,
            effortDisplayName: effort.displayName
        )
    }

    /// Validates a candidate against the catalog, falling back to the default
    /// provider's default model, then the first selectable model.
    static func resolved(from candidate: ModelSelection?, in catalog: ModelsResponse) -> ModelSelection? {
        if let candidate,
           let provider = catalog.providers.first(where: { $0.providerId == candidate.providerId }),
           provider.isSelectable,
           let model = provider.models.first(where: { $0.id == candidate.modelId && $0.selectable }) {
            return .selecting(provider: provider, model: model, preservingEffortFrom: candidate)
        }

        guard let provider = catalog.providers.first(where: \.isSelectable),
              let model = provider.models.first(where: { $0.id == provider.defaultModel && $0.selectable })
                ?? provider.models.first(where: \.selectable) else {
            return nil
        }
        return .selecting(provider: provider, model: model, preservingEffortFrom: nil)
    }

    /// Whether every part of the selection is selectable in the loaded catalog.
    func isValid(in catalog: ModelsResponse?) -> Bool {
        guard let provider = catalog?.providers.first(where: { $0.providerId == providerId }),
              provider.isSelectable,
              provider.models.contains(where: { $0.id == modelId && $0.selectable }) else {
            return false
        }
        guard let effortId else {
            return true
        }
        return provider.efforts.contains { $0.id == effortId && $0.selectable }
    }

    func matches(_ settings: SessionClientState.AgentSettings) -> Bool {
        let effort = settings.effort.isEmpty ? nil : settings.effort
        return providerId == settings.provider.providerId
            && modelId == settings.model
            && effortId == effort
    }
}

extension ModelSelection {
    init?(preference: NewSessionPreferences.LastSelectedModel?) {
        guard let preference else {
            return nil
        }
        self.init(
            providerId: ProviderId(rawValue: preference.providerId),
            modelId: preference.modelId,
            displayName: preference.displayName,
            effortId: preference.effortId,
            effortDisplayName: preference.effortDisplayName
        )
    }

    var preferenceValue: NewSessionPreferences.LastSelectedModel {
        NewSessionPreferences.LastSelectedModel(
            providerId: providerId.rawValue,
            modelId: modelId,
            displayName: displayName,
            effortId: effortId,
            effortDisplayName: effortDisplayName
        )
    }
}

extension AgentProviderID {
    var providerId: ProviderId? {
        switch self {
        case .claudeCode:
            .claudeCode
        case .openaiCodex:
            .openaiCodex
        case .unknown:
            nil
        }
    }
}
