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
                HomeContainer()
                    .environment(
                        \.homeBuilder,
                        HomeBuilder(
                            component: component.homeComponent,
                            sessionBuilder: SessionBuilder { session in
                                component.makeSessionComponent(session: session)
                            }
                        )
                    )
            case .signedOut:
                SignedOutView(sessionStore: sessionStore)
            }
        }
        .task { await sessionStore.start() }
        .themedRoot()
    }
}
