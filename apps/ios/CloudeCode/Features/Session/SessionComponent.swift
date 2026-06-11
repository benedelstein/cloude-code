import NeedleFoundation
import SwiftUI

protocol SessionDependency: Dependency {}

final class SessionComponent: Component<SessionDependency> {
    private let session: SessionSummary

    init(parent: Scope, session: SessionSummary) {
        self.session = session
        super.init(parent: parent)
    }

    @MainActor
    var store: SessionFeatureStore {
        shared {
            SessionFeatureStore(session: session)
        }
    }
}

@MainActor
struct SessionBuilder {
    let makeComponent: (SessionSummary) -> SessionComponent

    func build(session: SessionSummary) -> some View {
        SessionView(store: makeComponent(session).store)
    }
}
