import SwiftUI
import UIKit

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
    let largeTitleFont: Font = .regular(34)
    let title1Font: Font = .regular(28)
    let title2Font: Font = .regular(22)
    let title3Font: Font = .system(size: 20, weight: .regular)
    let headlineFont: Font = .semibold(17)
    let bodyFont: Font = .regular(17)
    let calloutFont: Font = .regular(16)
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

    var responseTextFont: Font {
        Font.body(17)
    }
}

extension Font {
    static func regular(_ size: CGFloat) -> Font {
        .system(size: size, weight: .regular)
    }

    static func semibold(_ size: CGFloat) -> Font {
        .system(size: size, weight: .semibold)
    }

    static func medium(_ size: CGFloat) -> Font {
        .system(size: size, weight: .medium)
    }

    static func bold(_ size: CGFloat) -> Font {
        .system(size: size, weight: .bold)
    }

    static func body(_ size: CGFloat) -> Font {
        .system(size: size, weight: .regular)
    }
}

extension EnvironmentValues {
    @Entry
    var style: Style = .init()
}
