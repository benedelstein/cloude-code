import Domain
import FirebaseCore
import FirebaseMessaging
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
        if FirebaseApp.app() == nil, let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
           let options = FirebaseOptions(contentsOfFile: path) {
            FirebaseApp.configure(options: options)
        } else {
            Logger.warning("Firebase configuration plist is missing or invalid")
        }
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Messaging.messaging().apnsToken = deviceToken
    }
}
