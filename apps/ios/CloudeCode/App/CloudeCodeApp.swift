import SwiftUI

@main
struct CloudeCodeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    private var component: ApplicationComponent {
        RootComponent.shared.applicationComponent
    }

    var body: some Scene {
        WindowGroup {
            RootView(component: component)
        }
    }
}
