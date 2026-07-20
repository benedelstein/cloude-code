import API
import CoreAPI
import Domain
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
    var claudeViewModel: ClaudeProviderConnectionViewModel {
        shared {
            ClaudeProviderConnectionViewModel(
                context: context,
                api: dependency.providerAuthAPI,
                modelCatalogStore: dependency.modelCatalogStore
            )
        }
    }

    @MainActor
    var openAIViewModel: OpenAIProviderConnectionViewModel {
        shared {
            OpenAIProviderConnectionViewModel(
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
    @ViewBuilder
    func build(
        context: ProviderConnectionContext,
        onConnected: @escaping () -> Void
    ) -> some View {
        let component: ProviderConnectionComponent = makeComponent(context)
        switch context.providerId {
        case .claudeCode:
            ProviderConnectionView {
                ClaudeProviderConnectionView(
                    viewModel: component.claudeViewModel,
                    onConnected: onConnected
                )
            }
        case .openaiCodex:
            ProviderConnectionView {
                OpenAIProviderConnectionView(
                    viewModel: component.openAIViewModel,
                    onConnected: onConnected
                )
            }
        case .unknown(let name):
            ProviderConnectionView {
                ErrorStateView(
                    title: "Unsupported Provider",
                    subtitle: "Update your app to connect \(name)"
                ) {
                    Image(systemName: "questionmark")
                }
            }
        }
    }
}

extension EnvironmentValues {
    @Entry
    var providerConnectionBuilder: ProviderConnectionBuilder?
}
