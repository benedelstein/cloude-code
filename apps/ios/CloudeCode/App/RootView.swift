import SwiftUI

struct RootView: View {
    private let component: ApplicationComponent
    private let sessionStore: SessionStore
    private let logStore: AppLogStore
    @State private var isSettingsPresented = false

    init(component: ApplicationComponent, logStore: AppLogStore) {
        self.component = component
        self.logStore = logStore
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
        .transition(.opacity.animation(.easeIn(duration: 0.3)))
        .environment(\.openSettings, OpenSettingsAction {
            isSettingsPresented = true
        })
        .sheet(isPresented: $isSettingsPresented) {
            SettingsView(logStore: logStore)
        }
        .task { await sessionStore.start() }
        .themedRoot()
    }
}
