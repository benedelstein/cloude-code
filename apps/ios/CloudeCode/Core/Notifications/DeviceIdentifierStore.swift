import Foundation
import UIKit

struct DeviceIdentifierStore {
    private let userDefaults: UserDefaults
    private let key: String

    init(
        userDefaults: UserDefaults = .standard,
        key: String = "notifications.deviceId"
    ) {
        self.userDefaults = userDefaults
        self.key = key
    }

    func deviceId() -> String {
        if let identifier = UIDevice.current.identifierForVendor?.uuidString.lowercased() {
            return identifier
        }

        if let existing = userDefaults.string(forKey: key), !existing.isEmpty {
            return existing
        }

        let value = UUID().uuidString.lowercased()
        userDefaults.set(value, forKey: key)
        return value
    }
}
