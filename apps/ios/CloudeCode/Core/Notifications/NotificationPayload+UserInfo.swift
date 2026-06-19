import CoreAPI
import Foundation

extension NotificationMessageData {
    init?(from userInfo: [AnyHashable: Any]) {
        let stringData = userInfo.reduce(into: [String: String]()) { result, element in
            guard let key = element.key as? String, let value = element.value as? String else {
                return
            }

            result[key] = value
        }

        guard
            let data = try? JSONSerialization.data(withJSONObject: stringData),
            let decoded = try? JSONDecoder().decode(NotificationMessageData.self, from: data)
        else {
            return nil
        }

        self = decoded
    }
}

extension CoreAPI.NotificationPayload {
    init?(from userInfo: [AnyHashable: Any]) {
        guard let notificationData = NotificationMessageData(from: userInfo) else {
            return nil
        }

        self.init(jsonString: notificationData.payload)
    }

    init?(jsonString: String) {
        guard let data = jsonString.data(using: .utf8) else {
            return nil
        }

        guard let decoded = try? JSONDecoder().decode(NotificationPayload.self, from: data) else {
            return nil
        }

        self = decoded
    }
}
