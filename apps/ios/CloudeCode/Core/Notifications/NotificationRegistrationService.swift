import API
import CoreAPI
import Domain
import FirebaseMessaging
import Foundation
import UserNotifications

final class NotificationRegistrationService: NSObject {
    private let notificationsAPI: any NotificationsAPIProviding
    private let deviceIdentifierStore: DeviceIdentifierStore
    private var pendingToken: String?
    private var hasStarted = false

    init(
        notificationsAPI: any NotificationsAPIProviding,
        deviceIdentifierStore: DeviceIdentifierStore = DeviceIdentifierStore()
    ) {
        self.notificationsAPI = notificationsAPI
        self.deviceIdentifierStore = deviceIdentifierStore
    }

    func start() {
        guard !hasStarted else { return }
        hasStarted = true

        Messaging.messaging().delegate = self
        UNUserNotificationCenter.current().delegate = self
    }

    func requestNotificationAuthorization() async {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .badge, .sound]
            )
            if granted {
                Logger.debug("Notification authorization granted")
            } else {
                Logger.debug("Notification authorization not granted")
            }
        } catch {
            Logger.warning("Notification authorization request failed", error)
        }
    }

    func uploadTokenIfAvailable() async {
        let token: String
        if let pendingToken {
            token = pendingToken
        } else {
            do {
                token = try await Messaging.messaging().token()
                pendingToken = token
            } catch {
                Logger.warning("FCM token fetch failed", error)
                return
            }
        }

        guard let deviceId = await deviceIdentifierStore.deviceId() else {
            Logger.warning("Skipping FCM token upload because identifierForVendor is unavailable")
            return
        }

        do {
            try await notificationsAPI.registerFcmToken(deviceId: deviceId, token: token)
            if pendingToken == token {
                pendingToken = nil
            }
            Logger.debug("Uploaded FCM token")
        } catch {
            Logger.warning("FCM token upload failed", error)
        }
    }

    private func handleToken(_ token: String) {
        pendingToken = token
    }
}

extension NotificationRegistrationService: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken else { return }
        handleToken(fcmToken)
    }
}

extension NotificationRegistrationService: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        _ = NotificationPayload(from: response.notification.request.content.userInfo)
    }
}
