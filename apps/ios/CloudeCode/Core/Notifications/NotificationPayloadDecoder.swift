import CoreAPI
import Foundation

enum NotificationPayloadDecoder {
    static func decodePayload(from userInfo: [AnyHashable: Any]) -> NotificationPayload? {
        guard
            let payload = userInfo["payload"] as? String,
            let data = payload.data(using: .utf8)
        else {
            return nil
        }

        return try? JSONDecoder().decode(NotificationPayload.self, from: data)
    }
}
