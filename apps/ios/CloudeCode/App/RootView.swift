import SwiftUI

struct RootView: View {
    @Environment(\.theme) var theme: Theme
    private let component: ApplicationComponent
    private let sessionStore: SessionStore
    private let notificationRegistrationService: NotificationRegistrationService
    private let logStore: AppLogStore
    @State private var isSettingsPresented = false

    init(component: ApplicationComponent, logStore: AppLogStore) {
        self.component = component
        self.logStore = logStore
        sessionStore = component.sessionStore
        notificationRegistrationService = component.notificationRegistrationService
    }

    var body: some View {
        ZStack {
            Group {
                switch sessionStore.state {
                case .loading:
                    theme.backgroundColor.ignoresSafeArea()
                case .signedIn:
                    HomeBuilder(component: component.homeComponent).build()
                case .signedOut:
                    SignedOutView(sessionStore: sessionStore)
                }
            }
            .transition(.opacity.animation(.easeIn(duration: 0.3)))
            .zIndex(1)
        }
        .background(theme.backgroundColor)
        .environment(\.openSettings, OpenSettingsAction {
            isSettingsPresented = true
        })
        .environment(\.notificationRegistrationService, notificationRegistrationService)
        .sheet(isPresented: $isSettingsPresented) {
            SettingsView(logStore: logStore)
        }
        .task { await sessionStore.start() }
        .onDisappear { sessionStore.stop() }
        .themedRoot()
    }
}
