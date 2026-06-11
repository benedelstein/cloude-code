import SwiftUI

@main
struct CloudeCodeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var toastWindowController: ToastWindowController

    private var component: ApplicationComponent {
        RootComponent.shared.applicationComponent
    }

    init() {
        _toastWindowController = State(initialValue: ToastWindowController())
    }

    var body: some Scene {
        WindowGroup {
            RootView(component: component)
                .environment(\.showToast, ShowToastAction(windowController: toastWindowController))
                .background {
                    ToastWindowInstaller(controller: toastWindowController)
                }
        }
    }
}
