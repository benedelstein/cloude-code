import API
import Combine
import Entities
import NeedleFoundation
import SwiftUI

protocol AgentSessionDependency: Dependency {
    func makeSessionSocket(sessionId: String) -> SessionSocket

    var sessionsAPI: any SessionsAPIProviding { get }

    var reposAPI: any ReposAPIProviding { get }

    @MainActor
    var repoEnvironmentsStore: RepoEnvironmentsStore { get }

    var repoEnvironmentsAPI: any RepoEnvironmentsAPIProviding { get }

    @MainActor
    var modelCatalogStore: ModelCatalogStore { get }

    var providerAuthAPI: any ProviderAuthAPIProviding { get }

    var fetchImageAction: any FetchImageAction { get }

    var attachmentsAPI: any AttachmentsAPIProviding { get }

    @MainActor
    var sessionMessageStore: SessionMessageStore { get }

    @MainActor
    var sessionSummaryStore: SessionSummaryStore { get }

    @MainActor
    var newSessionPreferences: NewSessionPreferences { get }

    @MainActor
    var githubInstallationStore: GitHubInstallationStore { get }
}

/// Child of `HomeComponent`: agent sessions can only be opened from the
/// authenticated Home screen.
final class AgentSessionComponent: Component<AgentSessionDependency> {
    private let session: SessionSummaryModel?
    private let sessionCreatedSubject: PassthroughSubject<String, Never>

    init(
        parent: Scope,
        session: SessionSummaryModel?,
        sessionCreatedSubject: PassthroughSubject<String, Never>
    ) {
        self.session = session
        self.sessionCreatedSubject = sessionCreatedSubject
        super.init(parent: parent)
    }

    @MainActor
    private var transcriptBuilder: any AgentSessionTranscriptBuilding {
        shared {
            AgentSessionTranscriptBuilder()
        }
    }

    @MainActor
    private var renameSessionAction: RenameSessionAction {
        shared {
            RenameSessionAction(
                sessionsAPI: dependency.sessionsAPI,
                sessionSummaryStore: dependency.sessionSummaryStore
            )
        }
    }

    @MainActor
    private var archiveSessionAction: ArchiveSessionAction {
        shared {
            ArchiveSessionAction(
                sessionsAPI: dependency.sessionsAPI,
                sessionSummaryStore: dependency.sessionSummaryStore
            )
        }
    }

    @MainActor
    private var deleteSessionAction: DeleteSessionAction {
        shared {
            DeleteSessionAction(
                sessionsAPI: dependency.sessionsAPI,
                sessionSummaryStore: dependency.sessionSummaryStore
            )
        }
    }

    @MainActor
    var store: AgentSessionViewModel {
        shared {
            AgentSessionViewModel(
                context: context,
                modelCatalogStore: dependency.modelCatalogStore,
                preferences: dependency.newSessionPreferences,
                makeSocket: dependency.makeSessionSocket(sessionId:),
                sessionMessageStore: dependency.sessionMessageStore,
                sessionSummaryStore: dependency.sessionSummaryStore,
                transcriptBuilder: transcriptBuilder,
                sessionsAPI: dependency.sessionsAPI,
                attachmentsAPI: dependency.attachmentsAPI,
                renameSessionAction: renameSessionAction,
                archiveSessionAction: archiveSessionAction,
                deleteSessionAction: deleteSessionAction,
                sessionCreatedSubject: sessionCreatedSubject
            )
        }
    }

    var fetchImageAction: any FetchImageAction {
        dependency.fetchImageAction
    }

    var repoEnvironmentsAPI: any RepoEnvironmentsAPIProviding {
        dependency.repoEnvironmentsAPI
    }

    @MainActor
    var repoEnvironmentsStore: RepoEnvironmentsStore {
        dependency.repoEnvironmentsStore
    }

    var providerAuthAPI: any ProviderAuthAPIProviding {
        dependency.providerAuthAPI
    }

    @MainActor
    var modelCatalogStore: ModelCatalogStore {
        dependency.modelCatalogStore
    }

    func makeEnvironmentEditorComponent(
        mode: EnvironmentEditorViewModel.Mode
    ) -> EnvironmentEditorComponent {
        EnvironmentEditorComponent(parent: self, mode: mode)
    }

    @MainActor
    var environmentEditorBuilder: EnvironmentEditorBuilder {
        EnvironmentEditorBuilder { [self] mode in
            makeEnvironmentEditorComponent(mode: mode)
        }
    }

    func makeProviderConnectionComponent(
        context: ProviderConnectionContext
    ) -> ProviderConnectionComponent {
        ProviderConnectionComponent(parent: self, context: context)
    }

    @MainActor
    var providerConnectionBuilder: ProviderConnectionBuilder {
        ProviderConnectionBuilder { [self] context in
            makeProviderConnectionComponent(context: context)
        }
    }

    @MainActor
    private var context: AgentSessionViewModel.Context {
        if let session {
            return .session(session)
        }
        return .draft(newSessionDraft)
    }

    @MainActor
    private var newSessionDraft: NewSessionDraft {
        shared {
            NewSessionDraft(
                sessionsAPI: dependency.sessionsAPI,
                reposAPI: dependency.reposAPI,
                environmentsStore: dependency.repoEnvironmentsStore,
                preferences: dependency.newSessionPreferences,
                githubInstallationStore: dependency.githubInstallationStore
            )
        }
    }
}

@MainActor
struct AgentSessionBuilder {
    let makeComponent: (SessionSummaryModel?) -> AgentSessionComponent

    func build(session: SessionSummaryModel) -> some View {
        makeView(session: session)
    }

    func buildNewSession() -> some View {
        makeView(session: nil)
    }

    private func makeView(session: SessionSummaryModel?) -> some View {
        let component = makeComponent(session)
        return AgentSessionView(store: component.store)
            .environment(\.fetchImageAction, component.fetchImageAction)
            .environment(\.environmentEditorBuilder, component.environmentEditorBuilder)
            .environment(\.providerConnectionBuilder, component.providerConnectionBuilder)
    }
}
