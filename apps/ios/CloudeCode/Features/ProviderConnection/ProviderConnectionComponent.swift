import API
import NeedleFoundation
import SwiftUI

protocol ProviderConnectionDependency: Dependency {
    var providerAuthAPI: any ProviderAuthAPIProviding { get }

    @MainActor
    var modelCatalogStore: ModelCatalogStore { get }
}

/// Needle scope for one provider account connection flow.
final class ProviderConnectionComponent: Component<ProviderConnectionDependency> {
    private let context: ProviderConnectionContext

    init(parent: Scope, context: ProviderConnectionContext) {
        self.context = context
        super.init(parent: parent)
    }

    @MainActor
    var viewModel: ProviderConnectionViewModel {
        shared {
            ProviderConnectionViewModel(
                context: context,
                api: dependency.providerAuthAPI,
                modelCatalogStore: dependency.modelCatalogStore
            )
        }
    }
}

/// Builds provider connection sheets from the owning agent-session scope.
@MainActor
struct ProviderConnectionBuilder {
    let makeComponent: (ProviderConnectionContext) -> ProviderConnectionComponent

    /// Builds a provider connection flow and reports successful completion.
    func build(
        context: ProviderConnectionContext,
        onConnected: @escaping () -> Void
    ) -> some View {
        ProviderConnectionView(
            viewModel: makeComponent(context).viewModel,
            onConnected: onConnected
        )
    }
}

extension EnvironmentValues {
    @Entry
    var providerConnectionBuilder: ProviderConnectionBuilder?
}
