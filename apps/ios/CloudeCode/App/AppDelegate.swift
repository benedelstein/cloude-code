import Domain
import Entities
import FirebaseCore
import FirebaseMessaging
import UIKit

@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    private let cache: Cache
    private let notificationRegistrationService: NotificationRegistrationService
    private let sessionStore: SessionStore
    private let workers: [any Working]
    private var launchTask: Task<Void, Never>?

    override init() {
        // must call this first. otherwise dependencies will crash.
        registerProviderFactories()
        let component = RootComponent.shared.applicationComponent
        cache = component.cache
        notificationRegistrationService = component.notificationRegistrationService
        sessionStore = component.sessionStore
        workers = [component.cacheResetWorker]

        super.init()
    }

    func stop() {
        launchTask?.cancel()
        launchTask = nil
        workers.stopAll()
        sessionStore.stop()
    }

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        FirebaseApp.configure()
        Logger.info("App launched")
        // set up notification delegates.
        notificationRegistrationService.start()
        workers.startAll()
        launchTask = Task { @MainActor in
            do {
                try await cache.start()
            } catch {
                Logger.warning("Cache startup failed", error)
            }

            await sessionStore.start()
        }

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
