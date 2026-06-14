import UIKit

struct DeviceIdentifierStore: Sendable {
    @MainActor
    func deviceId() -> String? {
        UIDevice.current.identifierForVendor?.uuidString.lowercased()
    }
}
