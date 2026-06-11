import SwiftUI

/// App-wide layout, animation, and typography tokens. Views read the active
/// style from the environment (`@Environment(\.style)`).
struct Style {
    enum FontStyle {
        case largeTitle
        case title1, title2, title3
        case headline, body
        case callout, subheadline
        case footnote
        case caption, caption2
    }

    // MARK: Layout
    let gridSize: CGFloat = 8
    let horizontalPadding: CGFloat = 16
    let outlineThickness: CGFloat = 0.5
    let mainButtonHeight: CGFloat = 56

    var spacing: CGFloat {
        gridSize * 2
    }

    // MARK: Animation
    let springAnimation: Animation = .spring(response: 0.4, dampingFraction: 0.95)

    // MARK: Fonts
    // Standard iOS text styles at the default (Large) Dynamic Type size.
    let largeTitleFont: Font = .system(size: 34, weight: .regular)
    let title1Font: Font = .system(size: 28, weight: .regular)
    let title2Font: Font = .system(size: 22, weight: .regular)
    let title3Font: Font = .system(size: 20, weight: .regular)
    let headlineFont: Font = .system(size: 17, weight: .semibold)
    let bodyFont: Font = .system(size: 17, weight: .regular)
    let calloutFont: Font = .system(size: 16, weight: .regular)
    let subheadlineFont: Font = .system(size: 15, weight: .regular)
    let footnoteFont: Font = .system(size: 13, weight: .regular)
    let captionFont: Font = .system(size: 12, weight: .regular)
    let caption2Font: Font = .system(size: 11, weight: .regular)

    func font(_ style: FontStyle) -> Font {
        let fonts: [FontStyle: Font] = [
            .largeTitle: largeTitleFont,
            .title1: title1Font,
            .title2: title2Font,
            .title3: title3Font,
            .headline: headlineFont,
            .body: bodyFont,
            .callout: calloutFont,
            .subheadline: subheadlineFont,
            .footnote: footnoteFont,
            .caption: captionFont,
            .caption2: caption2Font
        ]
        return fonts[style, default: bodyFont]
    }
}

extension EnvironmentValues {
    @Entry
    var style: Style = .init()
}
