import SwiftUI

extension Color {
    /// Creates an opaque color from a 24-bit RGB hex value, e.g. `Color(hex: 0x12B8FF)`.
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
