import API
import Combine
import CoreAPI
import Domain
import FirebaseMessaging
import Foundation
import UIKit
import UserNotifications

final class NotificationRegistrationService: NSObject {
    private struct UploadRequest: Equatable {
        let authUser: AuthUserSession
        let token: String
    }

    private let notificationsAPI: any NotificationsAPIProviding
    private let deviceIdentifierStore: DeviceIdentifierStore
    private let authUserPublisher: AnyPublisher<AuthUserSession?, Never>
    private let fcmTokenSubject = CurrentValueSubject<String?, Never>(nil)
    private var cancellables = Set<AnyCancellable>()
    private var uploadTask: Task<Void, Never>?
    private var hasStarted = false

    init(
        notificationsAPI: any NotificationsAPIProviding,
        authUserPublisher: AnyPublisher<AuthUserSession?, Never>,
        deviceIdentifierStore: DeviceIdentifierStore = DeviceIdentifierStore()
    ) {
        self.notificationsAPI = notificationsAPI
        self.authUserPublisher = authUserPublisher
        self.deviceIdentifierStore = deviceIdentifierStore
    }

    func start() {
        guard !hasStarted else { return }
        hasStarted = true

        Messaging.messaging().delegate = self
        UNUserNotificationCenter.current().delegate = self

        authUserPublisher
            .combineLatest(fcmTokenSubject)
            .compactMap { authUser, token -> UploadRequest? in
                guard let authUser, let token else { return nil }
                return UploadRequest(authUser: authUser, token: token)
            }
            .removeDuplicates()
            .sink { [weak self] request in
                self?.uploadTask?.cancel()
                self?.uploadTask = Task { [weak self] in
                    await self?.uploadToken(request.token)
                }
            }
            .store(in: &cancellables)

        Task { [weak self] in
            await self?.fetchCurrentToken()
        }
    }

    @MainActor
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

        UIApplication.shared.registerForRemoteNotifications()
    }

    private func fetchCurrentToken() async {
        do {
            handleToken(try await Messaging.messaging().token())
        } catch {
            Logger.warning("FCM token fetch failed", error)
        }
    }

    private func uploadToken(_ token: String) async {
        guard let deviceId = await deviceIdentifierStore.deviceId() else {
            Logger.warning("Skipping FCM token upload because identifierForVendor is unavailable")
            return
        }

        do {
            try await notificationsAPI.registerFcmToken(deviceId: deviceId, token: token)
            Logger.debug("Uploaded FCM token")
        } catch {
            Logger.warning("FCM token upload failed", error)
        }
    }

    private func handleToken(_ token: String) {
        fcmTokenSubject.send(token)
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
