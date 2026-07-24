import Domain
import SwiftUI

@main
struct CloudeCodeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var logStore: AppLogStore
    @State private var toastWindowController: ToastWindowController
    private let hapticFeedbackPlayer: any HapticFeedbackPlaying

    private var component: ApplicationComponent {
        RootComponent.shared.applicationComponent
    }

    init() {
        let logStore = AppLogStore()
        Logger.shared.minimumLogLevel = .debug
        Logger.addDestination(MemoryLogDestination(store: logStore))
        _logStore = State(initialValue: logStore)
        _toastWindowController = State(initialValue: ToastWindowController())
        hapticFeedbackPlayer = SystemHapticFeedbackPlayer()
    }

    var body: some Scene {
        WindowGroup {
            RootView(component: component, logStore: logStore)
                .environment(\.showToast, ShowToastAction(windowController: toastWindowController))
                .environment(\.hapticFeedbackPlayer, hapticFeedbackPlayer)
                .background {
                    ToastWindowInstaller(controller: toastWindowController)
                }
                .onDisappear {
                    appDelegate.stop()
                }
        }
    }
}
