import API
import Domain
import FirebaseMessaging
import Foundation
import UIKit
import UserNotifications

@MainActor
final class NotificationRegistrationService: NSObject {
    private let notificationsAPI: any NotificationsAPIProviding
    private let deviceIdentifierStore: DeviceIdentifierStore
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
        guard !hasStarted else { return }
        hasStarted = true

        Messaging.messaging().delegate = self
        UNUserNotificationCenter.current().delegate = self
        UIApplication.shared.registerForRemoteNotifications()

        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .badge, .sound]
            )
            if !granted {
                Logger.debug("Notification authorization not granted")
            }
        } catch {
            Logger.warning("Notification authorization request failed", error)
        }

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
        pendingToken = token
        uploadPendingToken()
    }

    private func uploadPendingToken() {
        guard let token = pendingToken else { return }
        uploadTask?.cancel()
        let deviceId = deviceIdentifierStore.deviceId()
        uploadTask = Task { [notificationsAPI] in
            do {
                try await notificationsAPI.registerFcmToken(deviceId: deviceId, token: token)
                await MainActor.run {
                    if self.pendingToken == token {
                        self.pendingToken = nil
                    }
                }
                Logger.debug("Uploaded FCM token")
            } catch APIError.unauthenticated {
                Logger.debug("Deferring FCM token upload until authentication is available")
            } catch {
                Logger.warning("FCM token upload failed", error)
            }
        }
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
        _ = NotificationPayloadDecoder.decodePayload(
            from: response.notification.request.content.userInfo
        )
    }
}
