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

    @Test func blockMarkdownPreservesLineBreaksInDisplayText() {
        let source = "- one\n- **two**\n- three\n\nFirst paragraph.\n\nSecond paragraph."
        let parts = renderParts(for: source)

        #expect(parts.map(\.id) == [0])
        #expect(expectRichText(parts, at: 0)?.renderedText
            == "- one\n- two\n- three\n\nFirst paragraph.\n\nSecond paragraph.")
    }

    @Test func finalizedPartDisplayTextDropsOnlyTheBoundaryLineFeed() {
        let parts = renderParts(for: "First paragraph.\n\nSecond paragraph.", maxParagraphsPerPart: 1)

        #expect(expectRichText(parts, at: 0)?.source == "First paragraph.\n\n")
        #expect(expectRichText(parts, at: 0)?.renderedText == "First paragraph.\n")
        #expect(expectRichText(parts, at: 1)?.renderedText == "Second paragraph.")
    }

    @Test func paragraphsBatchUntilTheConfiguredBlankLineCount() {
        let cache = ChunkedTextRenderCache()
        let paragraphs = (1...6).map { "Paragraph \($0)." }
        let parts = renderParts(cache: cache, text: paragraphs.joined(separator: "\n\n"))

        #expect(parts.map(\.id) == [0, 1])
        #expect(expectRichText(parts, at: 0)?.source == paragraphs.prefix(5).map { $0 + "\n\n" }.joined())
        #expect(expectRichText(parts, at: 1)?.source == "Paragraph 6.")
    }

    @Test func incompleteEmphasisUpdatesWhenDelimiterArrives() {
        let cache = ChunkedTextRenderCache()

        let first = renderParts(cache: cache, text: "Hello **bo")
        #expect(expectRichText(first, at: 0)?.renderedText == "Hello **bo")

        let second = renderParts(cache: cache, text: "Hello **bold**")
        #expect(expectRichText(second, at: 0)?.renderedText == "Hello bold")
        #expect(second.map(\.id) == [0])
    }

    @Test func incompleteSingleUnderscoreEmphasisStaysActiveBeforeHardBoundary() {
        let cache = ChunkedTextRenderCache(maxChunkUTF16Length: 80)

        let first = renderParts(cache: cache, text: "Hello _it")
        #expect(first.map(\.id) == [0])
        #expect(expectRichText(first, at: 0)?.source == "Hello _it")

        let second = renderParts(cache: cache, text: "Hello _italic_")
        #expect(second.map(\.id) == [0])
        #expect(expectRichText(second, at: 0)?.renderedText == "Hello italic")
    }

    @Test func blankLineFinalizesSafeRichTextAndKeepsTailActive() {
        let cache = ChunkedTextRenderCache(maxParagraphsPerPart: 1)

        let first = renderParts(cache: cache, text: "First paragraph.\n\nSec")
        #expect(first.map(\.id) == [0, 1])
        #expect(expectRichText(first, at: 0)?.source == "First paragraph.\n\n")
        #expect(expectRichText(first, at: 1)?.source == "Sec")

        let second = renderParts(cache: cache, text: "First paragraph.\n\nSecond paragraph.")
        #expect(second.map(\.id) == [0, 1])
        #expect(expectRichText(second, at: 0)?.source == "First paragraph.\n\n")
        #expect(expectRichText(second, at: 1)?.source == "Second paragraph.")
    }

    @Test func blankLineClosesUnsafeInlineMarkdownForFinalization() {
        let parts = renderParts(for: "Before **unfinished\n\nAfter", maxParagraphsPerPart: 1)

        #expect(parts.map(\.id) == [0, 1])
        #expect(expectRichText(parts, at: 0)?.source == "Before **unfinished\n\n")
        #expect(expectRichText(parts, at: 1)?.source == "After")
    }

    @Test func wordInternalUnderscoreDoesNotPreventBlankLineFinalization() {
        let parts = renderParts(for: "Use user_id here.\n\nNext", maxParagraphsPerPart: 1)

        #expect(parts.map(\.id) == [0, 1])
        #expect(expectRichText(parts, at: 0)?.source == "Use user_id here.\n\n")
        #expect(expectRichText(parts, at: 1)?.source == "Next")
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

    @Test func proseWithUnmatchedLinkLikeTextStillFinalizesAtHardCap() {
        let text = String(repeating: "the range [0, 1) keeps going ", count: 4)
        let parts = renderParts(for: text, maxChunkUTF16Length: 32)

        #expect(parts.count > 1)
        #expect(expectRichText(parts, at: 0)?.source.utf16.count == 32)
        #expect(expectRichText(parts, at: parts.count - 1)?.source.utf16.count ?? 0 <= 32)
    }

    @Test func proseWithLessThanAndLaterURLStillFinalizesAtHardCap() {
        let text = "a < b while we keep writing until https://example.com appears in ordinary prose"
        let parts = renderParts(for: text, maxChunkUTF16Length: 28)

        #expect(parts.count > 1)
        #expect(expectRichText(parts, at: 0)?.source.utf16.count == 28)
        #expect(expectRichText(parts, at: parts.count - 1)?.source.utf16.count ?? 0 <= 28)
    }

    @Test func emphasisMarkersInsideCodeSpanDoNotBlockBlankLineFinalization() {
        let parts = renderParts(for: "Pass `**kwargs` to the function.\n\nMore", maxParagraphsPerPart: 1)

        #expect(parts.map(\.id) == [0, 1])
        #expect(expectRichText(parts, at: 0)?.source == "Pass `**kwargs` to the function.\n\n")
        #expect(expectRichText(parts, at: 0)?.renderedText == "Pass **kwargs to the function.\n")
        #expect(expectRichText(parts, at: 1)?.source == "More")
    }

    @Test func inlineTripleBackticksAfterMidLineSplitDoNotBecomeCodeFence() {
        let cache = ChunkedTextRenderCache(
            maxChunkUTF16Length: 11,
            softBoundaryLookbackUTF16Length: 11,
            minimumSoftBoundaryUTF16Length: 0
        )
        let parts = renderParts(cache: cache, text: "alpha beta ``` inline ticks stay prose")

        #expect(parts.count > 1)
        #expect(parts.allSatisfy { part in
            if case .richText = part {
                return true
            }
            return false
        })
        #expect(renderedText(from: parts).contains("``` inline ticks stay prose"))
    }

    @Test func multiParagraphTextBeforeFenceFlushesAsOneBatchedPart() {
        let parts = renderParts(for: "First paragraph.\n\nSecond paragraph.\n\n```swift\nlet value = 1\n```")

        #expect(parts.map(\.id) == [0, 1])
        #expect(expectRichText(parts, at: 0)?.source == "First paragraph.\n\nSecond paragraph.\n\n")
        #expect(expectCodeBlock(parts, at: 1)?.text == "let value = 1")
    }

    @Test func inlineCodeLinkAutolinkAndEscapeRemainActiveUntilClosed() {
        let cases = [
            "Inline `code next",
            "Link [label](https://example.com next",
            "Autolink <https://example.com next",
            "Escaped slash \\"
        ]

        for text in cases {
            let parts = renderParts(for: text)
            #expect(parts.count == 1)
            #expect(expectRichText(parts, at: 0)?.source == text)
        }
    }

    @Test func textShrinkResetsCachedPartIdentity() {
        let cache = ChunkedTextRenderCache(maxParagraphsPerPart: 1)

        let first = renderParts(cache: cache, text: "First\n\nSecond")
        #expect(first.map(\.id) == [0, 1])

        let second = renderParts(cache: cache, text: "Short")
        #expect(second.map(\.id) == [0])
        #expect(expectRichText(second, at: 0)?.source == "Short")
    }

    @Test func changedPrefixResetsCachedPartIdentity() {
        let cache = ChunkedTextRenderCache(maxParagraphsPerPart: 1)

        let first = renderParts(cache: cache, text: "First\n\nSecond")
        #expect(first.map(\.id) == [0, 1])

        let second = renderParts(cache: cache, text: "Other\n\nSecond")
        #expect(second.map(\.id) == [0, 1])
        #expect(expectRichText(second, at: 0)?.source == "Other\n\n")
    }

    @Test func closingFenceAtEndOfTextIsNotFrozenAndCanReopen() {
        let cache = ChunkedTextRenderCache()

        let closed = renderParts(cache: cache, text: "```\nbody\n```")
        #expect(expectCodeBlock(closed, at: 0)?.isComplete == true)

        // ```x is not a valid closing fence, so the block must reopen.
        let reopened = renderParts(cache: cache, text: "```\nbody\n```x")
        #expect(reopened.count == 1)
        #expect(expectCodeBlock(reopened, at: 0)?.isComplete == false)
        #expect(expectCodeBlock(reopened, at: 0)?.text == "body\n```x")
    }

    @Test func streamedAndOneShotPartsCarryIdenticalContent() {
        let text = "Intro **bold** text\n\n```swift\nlet x = 1\n```\n\n- a\n- b\n\nEnd `code` _em_."

        let streamingCache = ChunkedTextRenderCache()
        var current = ""
        var streamedParts: [MarkdownTextPart] = []
        for character in text {
            current.append(character)
            streamedParts = renderParts(cache: streamingCache, text: current)
        }

        #expect(concatenatedContent(of: streamedParts) == concatenatedContent(of: renderParts(for: text)))
    }

    @Test func hardCapSplitInSurrogatePairTextPreservesAllCharacters() {
        let text = String(repeating: "😀", count: 80)
        let parts = renderParts(for: text, maxChunkUTF16Length: 45)

        #expect(parts.count > 1)
        #expect(concatenatedContent(of: parts) == text)
    }

    @Test func independentTextItemKeysKeepIndependentCaches() {
        let cache = ChunkedTextRenderCache(maxParagraphsPerPart: 1)

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
    maxChunkUTF16Length: Int = 2_400,
    maxParagraphsPerPart: Int = 5
) -> [MarkdownTextPart] {
    let cache = ChunkedTextRenderCache(
        maxChunkUTF16Length: maxChunkUTF16Length,
        maxParagraphsPerPart: maxParagraphsPerPart
    )
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

/// Joins part contents in order (code block bodies marked) so two chunkings of the
/// same text can be compared for content equality regardless of split positions.
private func concatenatedContent(of parts: [MarkdownTextPart]) -> String {
    parts.map { part in
        switch part {
        case .richText(let part):
            part.source
        case .codeBlock(let part):
            "<code>" + part.text + "</code>"
        }
    }.joined()
}

private func renderedText(from parts: [MarkdownTextPart]) -> String {
    parts.compactMap { part -> String? in
        guard case .richText(let richText) = part else {
            return nil
        }
        return richText.renderedText
    }.joined()
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
