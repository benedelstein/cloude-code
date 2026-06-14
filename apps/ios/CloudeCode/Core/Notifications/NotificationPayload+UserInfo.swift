import CoreAPI
import Foundation

extension NotificationPayload {
    init?(from userInfo: [AnyHashable: Any]) {
        guard
            let payload = userInfo["payload"] as? String,
            let data = payload.data(using: .utf8)
        else {
            return nil
        }

        guard let decoded = try? JSONDecoder().decode(NotificationPayload.self, from: data) else {
            return nil
        }

        self = decoded
    }
}
