import SwiftUI

struct RootView: View {
    private let component: ApplicationComponent
    private let sessionStore: SessionStore

    init(component: ApplicationComponent) {
        self.component = component
        sessionStore = component.sessionStore
    }

    var body: some View {
        Group {
            switch sessionStore.state {
            case .loading:
                ProgressView()
            case .signedIn:
                HomeBuilder(component: component.homeComponent).build()
            case .signedOut:
                SignedOutView(sessionStore: sessionStore)
            }
        }
        .task { await sessionStore.start() }
        .themedRoot()
    }
}
