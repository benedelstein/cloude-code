import Domain
import FirebaseCore
import FirebaseMessaging
import UIKit

@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    override init() {
        super.init()
    }

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        FirebaseApp.configure()
        registerProviderFactories()
        application.registerForRemoteNotifications()
        Logger.info("App launched")
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Messaging.messaging().apnsToken = deviceToken
    }
}
