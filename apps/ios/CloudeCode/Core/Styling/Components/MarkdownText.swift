import SwiftUI

struct MarkdownText: View {
    let text: String

    var body: some View {
        Text(attributedText)
    }

    private var attributedText: AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )

        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}
