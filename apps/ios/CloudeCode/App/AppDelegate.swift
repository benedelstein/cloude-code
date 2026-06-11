import Domain
import UIKit

@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    override init() {
        // always register this right away.
        registerProviderFactories()
        super.init()
        Logger.info("App launched")
    }

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // application setup code
        true
    }
}
