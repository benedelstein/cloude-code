import API
import Domain
import Entities
import NeedleFoundation
import SwiftUI

protocol EnvironmentEditorDependency: Dependency {
    var repoEnvironmentsAPI: any RepoEnvironmentsAPIProviding { get }

    @MainActor
    var repoEnvironmentsStore: RepoEnvironmentsStore { get }
}

/// Needle scope for one create or edit environment destination.
final class EnvironmentEditorComponent: Component<EnvironmentEditorDependency> {
    private let mode: EnvironmentEditorViewModel.Mode

    init(parent: Scope, mode: EnvironmentEditorViewModel.Mode) {
        self.mode = mode
        super.init(parent: parent)
    }

    @MainActor
    var viewModel: EnvironmentEditorViewModel {
        shared {
            EnvironmentEditorViewModel(
                mode: mode,
                api: dependency.repoEnvironmentsAPI,
                environmentsStore: dependency.repoEnvironmentsStore
            )
        }
    }
}

/// Builds an environment editor destination from its owning feature scope.
@MainActor
struct EnvironmentEditorBuilder {
    let makeComponent: (EnvironmentEditorViewModel.Mode) -> EnvironmentEditorComponent

    /// Builds a native editor and reports the canonical saved environment.
    func build(
        mode: EnvironmentEditorViewModel.Mode,
        onSaved: @escaping (Domain.RepoEnvironment) -> Void
    ) -> some View {
        EnvironmentEditorView(
            viewModel: makeComponent(mode).viewModel,
            onSaved: onSaved
        )
    }
}

extension EnvironmentValues {
    @Entry
    var environmentEditorBuilder: EnvironmentEditorBuilder?
}
