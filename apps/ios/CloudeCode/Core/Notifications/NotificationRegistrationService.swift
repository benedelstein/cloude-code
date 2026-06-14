import API
import CoreAPI
import Domain
import FirebaseMessaging
import Foundation
import UserNotifications

final class NotificationRegistrationService: NSObject, @unchecked Sendable {
    private let notificationsAPI: any NotificationsAPIProviding
    private let deviceIdentifierStore: DeviceIdentifierStore
    private let stateLock = NSLock()
    private var pendingToken: String?
    private var hasStarted = false
    private var uploadTask: Task<Void, Never>?

    init(
        notificationsAPI: any NotificationsAPIProviding,
        deviceIdentifierStore: DeviceIdentifierStore = DeviceIdentifierStore()
    ) {
        self.notificationsAPI = notificationsAPI
        self.deviceIdentifierStore = deviceIdentifierStore
    }

    func start() async {
        stateLock.lock()
        guard !hasStarted else {
            stateLock.unlock()
            return
        }
        hasStarted = true
        stateLock.unlock()

        Messaging.messaging().delegate = self
        UNUserNotificationCenter.current().delegate = self

        do {
            let token = try await Messaging.messaging().token()
            handleToken(token)
        } catch {
            Logger.warning("FCM token fetch failed", error)
        }
    }

    func retryPendingTokenUpload() {
        uploadPendingToken()
    }

    private func handleToken(_ token: String) {
        stateLock.lock()
        pendingToken = token
        stateLock.unlock()
        uploadPendingToken()
    }

    private func uploadPendingToken() {
        stateLock.lock()
        guard let token = pendingToken else {
            stateLock.unlock()
            return
        }
        uploadTask?.cancel()
        uploadTask = Task { [notificationsAPI, deviceIdentifierStore] in
            guard let deviceId = await deviceIdentifierStore.deviceId() else {
                Logger.warning("Skipping FCM token upload because identifierForVendor is unavailable")
                return
            }
            do {
                try await notificationsAPI.registerFcmToken(deviceId: deviceId, token: token)
                self.clearPendingToken(token)
                Logger.debug("Uploaded FCM token")
            } catch APIError.unauthenticated {
                Logger.debug("Deferring FCM token upload until authentication is available")
            } catch {
                Logger.warning("FCM token upload failed", error)
            }
        }
        stateLock.unlock()
    }

    private func clearPendingToken(_ token: String) {
        stateLock.lock()
        if pendingToken == token {
            pendingToken = nil
        }
        stateLock.unlock()
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
