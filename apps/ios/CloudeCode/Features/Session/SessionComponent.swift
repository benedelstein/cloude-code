import NeedleFoundation
import SwiftUI

protocol SessionDependency: Dependency {}

final class SessionComponent: Component<SessionDependency> {
    private let session: HomeSessionRow

    init(parent: Scope, session: HomeSessionRow) {
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
    let makeComponent: (HomeSessionRow) -> SessionComponent

    func build(session: HomeSessionRow) -> some View {
        SessionView(store: makeComponent(session).store)
    }
}
