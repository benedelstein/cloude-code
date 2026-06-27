@testable import CloudeCode
import Foundation
import Testing

@Suite("Markdown text render cache")
struct ChunkedTextRenderCacheTests {
    @Test func inlineMarkdownRendersAsRichTextCharacters() {
        let parts = renderParts(for: "Hello **bold** and *italic* [site](https://example.com)")

        let richText = expectRichText(parts, at: 0)
        #expect(richText?.source == "Hello **bold** and *italic* [site](https://example.com)")
        #expect(richText?.renderedText == "Hello bold and italic site")
    }

    @Test func incompleteEmphasisUpdatesWhenDelimiterArrives() {
        let cache = ChunkedTextRenderCache()

        let first = renderParts(cache: cache, text: "Hello **bo")
        #expect(expectRichText(first, at: 0)?.renderedText == "Hello **bo")

        let second = renderParts(cache: cache, text: "Hello **bold**")
        #expect(expectRichText(second, at: 0)?.renderedText == "Hello bold")
        #expect(second.map(\.id) == [0])
    }

    @Test func blankLineFinalizesSafeRichTextAndKeepsTailActive() {
        let cache = ChunkedTextRenderCache()

        let first = renderParts(cache: cache, text: "First paragraph.\n\nSec")
        #expect(first.map(\.id) == [0, 1])
        #expect(expectRichText(first, at: 0)?.source == "First paragraph.\n\n")
        #expect(expectRichText(first, at: 1)?.source == "Sec")

        let second = renderParts(cache: cache, text: "First paragraph.\n\nSecond paragraph.")
        #expect(second.map(\.id) == [0, 1])
        #expect(expectRichText(second, at: 0)?.source == "First paragraph.\n\n")
        #expect(expectRichText(second, at: 1)?.source == "Second paragraph.")
    }

    @Test func unsafeInlineMarkdownPreventsBlankLineFinalization() {
        let parts = renderParts(for: "Before **unfinished\n\nAfter")

        #expect(parts.map(\.id) == [0])
        #expect(expectRichText(parts, at: 0)?.source == "Before **unfinished\n\nAfter")
    }

    @Test func completeCodeFenceBecomesSingleCodeBlock() {
        let parts = renderParts(for: "```ts\nlet value = 1\n```")

        let codeBlock = expectCodeBlock(parts, at: 0)
        #expect(codeBlock?.language == "ts")
        #expect(codeBlock?.text == "let value = 1")
        #expect(codeBlock?.isComplete == true)
    }

    @Test func textBeforeAndAfterCodeFenceKeepsSourceOrder() {
        let parts = renderParts(for: "Before\n\n```swift\nlet value = 1\n```\nAfter")

        #expect(parts.map(\.id) == [0, 1, 2])
        #expect(expectRichText(parts, at: 0)?.source == "Before\n\n")
        #expect(expectCodeBlock(parts, at: 1)?.text == "let value = 1")
        #expect(expectCodeBlock(parts, at: 1)?.language == "swift")
        #expect(expectRichText(parts, at: 2)?.source == "After")
    }

    @Test func unterminatedCodeFenceStreamsAsIncompleteBlock() {
        let parts = renderParts(for: "```tsx\nconst value = 1")

        let codeBlock = expectCodeBlock(parts, at: 0)
        #expect(codeBlock?.language == "tsx")
        #expect(codeBlock?.text == "const value = 1")
        #expect(codeBlock?.isComplete == false)
    }

    @Test func delayedClosingFenceFinalizesCodeBlockAndStartsFollowingText() {
        let cache = ChunkedTextRenderCache()

        let first = renderParts(cache: cache, text: "```ts\nconst value = 1")
        #expect(expectCodeBlock(first, at: 0)?.isComplete == false)

        let second = renderParts(cache: cache, text: "```ts\nconst value = 1\n```\nDone")
        #expect(second.map(\.id) == [0, 1])
        #expect(expectCodeBlock(second, at: 0)?.text == "const value = 1")
        #expect(expectCodeBlock(second, at: 0)?.isComplete == true)
        #expect(expectRichText(second, at: 1)?.source == "Done")
    }

    @Test func codeFenceBypassesHardLengthTextSplitting() {
        let longCode = String(repeating: "let value = 1\n", count: 20)
        let parts = renderParts(
            for: "```swift\n\(longCode)```",
            maxChunkUTF16Length: 8
        )

        #expect(parts.count == 1)
        #expect(expectCodeBlock(parts, at: 0)?.text == longCode.trimmingSuffix("\n"))
    }

    @Test func inlineCodeLinkAutolinkAndEscapeRemainActiveUntilClosed() {
        let cases = [
            "Inline `code\n\nnext",
            "Link [label](https://example.com\n\nnext",
            "Autolink <https://example.com\n\nnext",
            "Escaped slash \\\n\nnext"
        ]

        for text in cases {
            let parts = renderParts(for: text)
            #expect(parts.count == 1)
            #expect(expectRichText(parts, at: 0)?.source == text)
        }
    }

    @Test func textShrinkResetsCachedPartIdentity() {
        let cache = ChunkedTextRenderCache()

        let first = renderParts(cache: cache, text: "First\n\nSecond")
        #expect(first.map(\.id) == [0, 1])

        let second = renderParts(cache: cache, text: "Short")
        #expect(second.map(\.id) == [0])
        #expect(expectRichText(second, at: 0)?.source == "Short")
    }

    @Test func changedPrefixResetsCachedPartIdentity() {
        let cache = ChunkedTextRenderCache()

        let first = renderParts(cache: cache, text: "First\n\nSecond")
        #expect(first.map(\.id) == [0, 1])

        let second = renderParts(cache: cache, text: "Other\n\nSecond")
        #expect(second.map(\.id) == [0, 1])
        #expect(expectRichText(second, at: 0)?.source == "Other\n\n")
    }

    @Test func independentTextItemKeysKeepIndependentCaches() {
        let cache = ChunkedTextRenderCache()

        let first = renderParts(cache: cache, key: "first", text: "One\n\nTwo")
        let second = renderParts(cache: cache, key: "second", text: "Alpha")
        let firstUpdated = renderParts(cache: cache, key: "first", text: "One\n\nTwo updated")

        #expect(first.map(\.id) == [0, 1])
        #expect(second.map(\.id) == [0])
        #expect(firstUpdated.map(\.id) == [0, 1])
        #expect(expectRichText(firstUpdated, at: 1)?.source == "Two updated")
    }
}

private func renderParts(
    for text: String,
    maxChunkUTF16Length: Int = 2_400
) -> [MarkdownTextPart] {
    let cache = ChunkedTextRenderCache(maxChunkUTF16Length: maxChunkUTF16Length)
    return renderParts(cache: cache, text: text)
}

private func renderParts(
    cache: ChunkedTextRenderCache,
    key: String = "message-text-0",
    text: String
) -> [MarkdownTextPart] {
    let items = cache.renderItems(from: [
        .text(.init(key: key, text: text))
    ])

    guard case .chunkedText(let item) = items.first else {
        Issue.record("Expected chunked text item")
        return []
    }

    return item.parts
}

private func expectRichText(
    _ parts: [MarkdownTextPart],
    at index: Int
) -> MarkdownRichTextPart? {
    guard parts.indices.contains(index) else {
        Issue.record("Missing part at index \(index)")
        return nil
    }
    guard case .richText(let part) = parts[index] else {
        Issue.record("Expected rich text part")
        return nil
    }
    return part
}

private func expectCodeBlock(
    _ parts: [MarkdownTextPart],
    at index: Int
) -> MarkdownCodeBlockPart? {
    guard parts.indices.contains(index) else {
        Issue.record("Missing part at index \(index)")
        return nil
    }
    guard case .codeBlock(let part) = parts[index] else {
        Issue.record("Expected code block part")
        return nil
    }
    return part
}

private extension MarkdownRichTextPart {
    var renderedText: String {
        String(attributedText.characters)
    }
}

private extension String {
    func trimmingSuffix(_ suffix: String) -> String {
        guard hasSuffix(suffix) else {
            return self
        }
        return String(dropLast(suffix.count))
    }
}
