import SwiftUI

/// Semantic color tokens. Views read the active theme from the environment
/// (`@Environment(\.theme)`) instead of referencing raw colors directly.
struct Theme {
    // MARK: Backgrounds
    var backgroundColor: Color = .white
    var secondaryBackgroundColor = Color(hex: 0xF4F4F4)
    var highlightColor = Color(hex: 0xF0F0F0)
    /// Disabled button background
    var disabledBackgroundColor = Color(hex: 0xC8C8C8)
    var loadingBackgroundColor = Color(hex: 0xE8E8E8)
    var sliderBackgroundColor = Color(hex: 0xD9D9D9)

    // MARK: Labels
    var labelColor: Color = .black
    var secondaryLabelColor = Color(hex: 0x7E7E7E)

    // MARK: Outlines
    var outlineColor = Color(hex: 0xB2B2B2)

    // MARK: Accents
    var accentBlue = Color(hex: 0x12B8FF)
    var accentOrange = Color(hex: 0xFF5101)
    var moneyGreen = Color(hex: 0x1FE053)
    var errorRed = Color(hex: 0xF51A12)
}

extension EnvironmentValues {
    @Entry
    var theme: Theme = .init()
}
