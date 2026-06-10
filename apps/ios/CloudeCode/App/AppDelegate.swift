import UIKit

@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    override init() {
        registerProviderFactories()
        super.init()
        Logger.info("App launched")
    }
}
