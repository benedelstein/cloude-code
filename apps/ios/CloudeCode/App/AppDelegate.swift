import Domain
import FirebaseCore
import FirebaseMessaging
import UIKit

@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    private let notificationRegistrationService: NotificationRegistrationService

    override init() {
        // must call this first. otherwise dependencies will crash.
        registerProviderFactories()
        notificationRegistrationService = RootComponent.shared.applicationComponent.notificationRegistrationService

        super.init()
    }

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        FirebaseApp.configure()
        Logger.info("App launched")
        // set up notification delegates.
        notificationRegistrationService.start()

        if let userInfo = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            notificationRegistrationService.handleLaunchRemoteNotification(userInfo)
        }

        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Messaging.messaging().apnsToken = deviceToken
        Logger.debug("Registered APNs token")
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Logger.warning("Remote notification registration failed", error)
    }
}
