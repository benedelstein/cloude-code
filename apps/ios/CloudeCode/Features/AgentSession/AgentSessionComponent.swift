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

    var fetchImageAction: any FetchImageAction { get }

    var attachmentsAPI: any AttachmentsAPIProviding { get }

    @MainActor
    var sessionMessageStore: SessionMessageStore { get }

    @MainActor
    var sessionSummaryStore: SessionSummaryStore { get }

    @MainActor
    var newSessionPreferences: NewSessionPreferences { get }
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
                preferences: dependency.newSessionPreferences
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
    }
}
