import API
import Entities
import NeedleFoundation
import SwiftUI

protocol AgentSessionDependency: Dependency {
    func makeSessionSocket(sessionId: String) -> SessionSocket

    var sessionsAPI: any SessionsAPIProviding { get }

    var reposAPI: any ReposAPIProviding { get }

    var modelsAPI: any ModelsAPIProviding { get }

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

    init(parent: Scope, session: SessionSummaryModel?) {
        self.session = session
        super.init(parent: parent)
    }

    @MainActor
    private var transcriptBuilder: any AgentSessionTranscriptBuilding {
        shared {
            AgentSessionTranscriptBuilder()
        }
    }

    @MainActor
    var store: AgentSessionViewModel {
        shared {
            AgentSessionViewModel(
                context: context,
                modelPicker: modelPicker,
                makeSocket: dependency.makeSessionSocket(sessionId:),
                sessionMessageStore: dependency.sessionMessageStore,
                sessionSummaryStore: dependency.sessionSummaryStore,
                transcriptBuilder: transcriptBuilder,
                attachmentsAPI: dependency.attachmentsAPI
            )
        }
    }

    var fetchImageAction: any FetchImageAction {
        dependency.fetchImageAction
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
                modelPicker: modelPicker,
                preferences: dependency.newSessionPreferences
            )
        }
    }

    @MainActor
    private var modelPicker: ModelPickerState {
        shared {
            ModelPickerState(modelsAPI: dependency.modelsAPI)
        }
    }
}

@MainActor
struct AgentSessionBuilder {
    let makeComponent: (SessionSummaryModel?) -> AgentSessionComponent

    func build(session: SessionSummaryModel) -> some View {
        let component = makeComponent(session)
        return AgentSessionView(store: component.store)
            .environment(\.fetchImageAction, component.fetchImageAction)
    }

    func buildNewSession(onSessionCreated: @escaping (String) -> Void) -> some View {
        let component = makeComponent(nil)
        return AgentSessionView(
            store: component.store,
            onSessionCreated: onSessionCreated
        )
            .environment(\.fetchImageAction, component.fetchImageAction)
    }
}
