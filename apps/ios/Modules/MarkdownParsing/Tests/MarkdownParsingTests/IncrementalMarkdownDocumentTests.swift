import Foundation
@testable import MarkdownParsing
import Testing

@Suite("Incremental Markdown document")
struct IncrementalMarkdownDocumentTests {
    @Test func headingAndListProduceSemanticBlocks() {
        var document = IncrementalMarkdownDocument()
        let source = "# Heading\n\n3. Three\n4. Four"

        let snapshot = document.update(source: source, isStreaming: false)

        #expect(snapshot.parts.map(\.source).joined() == source)
        #expect(snapshot.parts.count == 2)
        guard case .heading(level: 1, content: let heading) = snapshot.parts[0].block.content else {
            Issue.record("Expected heading")
            return
        }
        #expect(String(heading.characters) == "Heading")
        guard case .orderedList(startIndex: 3, items: let items) = snapshot.parts[1].block.content else {
            Issue.record("Expected ordered list")
            return
        }
        #expect(items.count == 2)
    }

    @Test func parsesHeadingsBreaksQuotesCodeAndTasks() {
        let source = """
        Heading
        =======

        ---

        > Quote
        >
        > - [x] done
        > - [ ] next

            indented()

        ```swift
        fenced()
        ```
        """
        let snapshot = completed(source)

        #expect(snapshot.parts.map(\.source).joined() == source)
        #expect(snapshot.parts.count == 5)
        guard case .heading(level: 1, _) = snapshot.parts[0].block.content else {
            Issue.record("Expected Setext heading")
            return
        }
        guard case .thematicBreak = snapshot.parts[1].block.content else {
            Issue.record("Expected thematic break")
            return
        }
        guard case .blockQuote(let blocks) = snapshot.parts[2].block.content,
              case .unorderedList(let items) = blocks.last?.content else {
            Issue.record("Expected quoted task list")
            return
        }
        #expect(items.map(\.checkbox) == [.checked, .unchecked])
        guard case .codeBlock(let indented) = snapshot.parts[3].block.content else {
            Issue.record("Expected indented code")
            return
        }
        #expect(indented.language == nil)
        guard case .codeBlock(let fenced) = snapshot.parts[4].block.content else {
            Issue.record("Expected fenced code")
            return
        }
        #expect(fenced.language == "swift")
    }

    @Test func parsesInlineIntentsLinksBareURLsAndImageAltText() {
        let source = "**bold** *italic* ~~strike~~ `code` [link](https://example.com/a) "
            + "https://example.com/b. ![alt](https://example.com/image.png)"
        let snapshot = completed(source)
        guard case .prose(let paragraphs) = snapshot.parts.first?.block.content,
              let content = paragraphs.first?.content else {
            Issue.record("Expected prose")
            return
        }

        #expect(String(content.characters) == "bold italic strike code link https://example.com/b. alt")
        #expect(content.runs.contains { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
        #expect(content.runs.contains { $0.inlinePresentationIntent?.contains(.emphasized) == true })
        #expect(content.runs.contains { $0.inlinePresentationIntent?.contains(.strikethrough) == true })
        #expect(content.runs.contains { $0.inlinePresentationIntent?.contains(.code) == true })
        #expect(content.runs.filter { $0.link != nil }.count == 3)
    }

    @Test func smartPunctuationIsDisabled() {
        let source = #"--flag --- "straight""#
        let snapshot = completed(source)
        guard case .prose(let paragraphs) = snapshot.parts.first?.block.content else {
            Issue.record("Expected prose")
            return
        }
        #expect(String(paragraphs[0].content.characters) == source)
    }

    @Test func tablesAndHTMLRemainAtomicLiterals() {
        let source = "| A | B |\n| - | - |\n| 1 | 2 |\n\n<section>HTML</section>"
        let snapshot = completed(source)

        #expect(snapshot.parts.map(\.source).joined() == source)
        #expect(snapshot.parts.count == 2)
        guard case .literal = snapshot.parts[0].block.content,
              case .literal = snapshot.parts[1].block.content else {
            Issue.record("Expected literal fallbacks")
            return
        }
    }

    @Test func streamingHoldsAdjacentPredecessorUntilBlankLineMakesItStable() {
        var document = IncrementalMarkdownDocument()
        let adjacent = document.update(source: "para\n***", isStreaming: true)
        #expect(adjacent.parts.allSatisfy { $0.stability == .active })

        let reinterpreted = document.update(source: "para\n***x", isStreaming: true)
        #expect(reinterpreted.parts.count == 1)
        #expect(reinterpreted.parts[0].stability == .active)

        document.reset()
        let separated = document.update(source: "para\n\n***", isStreaming: true)
        #expect(separated.parts[0].stability == .finalized)
        #expect(separated.parts[1].stability == .active)
    }

    @Test func sixStreamingParagraphsFinalizeTheFirstFive() {
        var document = IncrementalMarkdownDocument()
        let source = (1...6).map { "Paragraph \($0)." }.joined(separator: "\n\n")
        let snapshot = document.update(source: source, isStreaming: true)

        #expect(snapshot.parts.count == 2)
        #expect(snapshot.parts[0].stability == .finalized)
        #expect(snapshot.parts[1].stability == .active)
        guard case .prose(let first) = snapshot.parts[0].block.content,
              case .prose(let second) = snapshot.parts[1].block.content else {
            Issue.record("Expected prose batches")
            return
        }
        #expect(first.count == 5)
        #expect(second.count == 1)
    }

    @Test func longProseUsesUnicodeSafeContinuationParts() {
        var configuration = IncrementalMarkdownDocument.Configuration()
        configuration.maximumProseUTF16Length = 24
        configuration.softBoundaryLookbackUTF16Length = 12
        configuration.minimumSoftBoundaryUTF16Length = 8
        var document = IncrementalMarkdownDocument(configuration: configuration)
        let source = "alpha 😀 beta ``` inline ticks stay prose and # heading stays prose"
        let snapshot = document.update(source: source, isStreaming: true)

        #expect(snapshot.parts.count > 1)
        #expect(snapshot.parts.map(\.source).joined() == source)
        #expect(snapshot.parts.dropFirst().contains { $0.leadingBoundary == .proseContinuation })
        #expect(snapshot.parts.allSatisfy {
            if case .prose = $0.block.content { return true }
            return false
        })
    }

    @Test func oversizedOpenInlineCodeStaysActiveUntilASafeBoundaryExists() {
        var configuration = IncrementalMarkdownDocument.Configuration()
        configuration.maximumProseUTF16Length = 24
        configuration.softBoundaryLookbackUTF16Length = 12
        configuration.minimumSoftBoundaryUTF16Length = 8
        var document = IncrementalMarkdownDocument(configuration: configuration)
        let openSource = "prefix `" + String(repeating: "code word ", count: 8)

        let open = document.update(source: openSource, isStreaming: true)

        #expect(open.parts.count == 1)
        #expect(open.parts[0].stability == .active)
        #expect(open.parts.map(\.source).joined() == openSource)

        let closedSource = openSource + "` safe trailing words for another part"
        let closed = document.update(source: closedSource, isStreaming: true)
        #expect(closed.parts.count > 1)
        #expect(closed.parts.map(\.source).joined() == closedSource)
        let rendered = renderedText(in: closed)
        #expect(rendered == "prefix " + String(repeating: "code word ", count: 8) + " safe trailing words for another part")
        #expect(closed.parts.contains { part in
            guard case .prose(let paragraphs) = part.block.content else { return false }
            return paragraphs.contains { paragraph in
                paragraph.content.runs.contains { $0.inlinePresentationIntent?.contains(.code) == true }
            }
        })
    }

    @Test func appendedReferenceSwitchesToWholeDocumentAndUpdatesEarlierLink() {
        var document = IncrementalMarkdownDocument()
        let initial = document.update(source: "See [docs][docs].", isStreaming: true)
        #expect(initial.mode == .incrementalTail)

        let source = "See [docs][docs].\n\n[docs]: https://example.com"
        let updated = document.update(source: source, isStreaming: true)
        #expect(updated.mode == .wholeDocument)
        #expect(updated.parts.map(\.source).joined() == source)
        guard case .prose(let paragraphs) = updated.parts.first?.block.content else {
            Issue.record("Expected linked prose")
            return
        }
        #expect(paragraphs[0].content.runs.contains { $0.link?.absoluteString == "https://example.com" })

        let completed = document.update(source: source, isStreaming: false)
        #expect(completed.mode == .wholeDocument)
        #expect(completed.parts.allSatisfy { $0.stability == .finalized })
    }

    @Test func definitionOnlySourceUsesSourceOnlyPart() {
        let source = "[docs]: https://example.com"
        let snapshot = completed(source)
        #expect(snapshot.mode == .wholeDocument)
        #expect(snapshot.parts.map(\.source).joined() == source)
        guard case .sourceOnly = snapshot.parts[0].block.content else {
            Issue.record("Expected source-only part")
            return
        }
    }

    @Test func definitionLikeTextInsideFinalizedCodeDoesNotChangeMode() {
        var document = IncrementalMarkdownDocument()
        let code = "```text\n[docs]: https://example.com\n```\n\n"
        _ = document.update(source: code + "Tail", isStreaming: true)
        let updated = document.update(source: code + "Tail grows", isStreaming: true)

        #expect(updated.mode == .incrementalTail)
        #expect(updated.parts.map(\.source).joined() == code + "Tail grows")
    }

    @Test func definitionLikeTextInsideFinalizedIndentedCodeDoesNotChangeMode() {
        var document = IncrementalMarkdownDocument()
        let code = "    [docs]: https://example.com\n\n"
        _ = document.update(source: code + "Tail", isStreaming: true)
        let updated = document.update(source: code + "Tail grows", isStreaming: true)

        #expect(updated.mode == .incrementalTail)
        #expect(updated.parts.map(\.source).joined() == code + "Tail grows")
    }

    @Test func everyStreamingPrefixPreservesRawSource() {
        let source = "Intro 😀\r\n\r\n# Heading\n\n- one\n  - nested\n\n```swift\nlet x = 1\n```\n\nEnd"
        var document = IncrementalMarkdownDocument()
        var prefix = ""
        for character in source {
            prefix.append(character)
            let snapshot = document.update(source: prefix, isStreaming: true)
            #expect(snapshot.parts.map(\.source).joined() == prefix)
        }
        let completed = document.update(source: source, isStreaming: false)
        #expect(completed.parts.map(\.source).joined() == source)
    }

    @Test func replacementAndShrinkResetSourceIdentities() {
        var document = IncrementalMarkdownDocument()
        _ = document.update(source: "First\n\nSecond", isStreaming: true)
        let replaced = document.update(source: "Other\n\nSecond", isStreaming: true)
        #expect(replaced.parts.map(\.source).joined() == "Other\n\nSecond")
        #expect(replaced.parts.first?.id.utf16SourceOffset == 0)

        let shrunk = document.update(source: "Short", isStreaming: true)
        #expect(shrunk.parts.map(\.source).joined() == "Short")
        #expect(shrunk.parts.first?.id.utf16SourceOffset == 0)
    }

    @Test func growingLargeListPreservesExistingItemIdentities() {
        var document = IncrementalMarkdownDocument()
        let firstSource = (1...25).map { "- item \($0)" }.joined(separator: "\n")
        let first = document.update(source: firstSource, isStreaming: true)
        guard case .unorderedList(let firstItems) = first.parts[0].block.content else {
            Issue.record("Expected list")
            return
        }

        let secondSource = firstSource + "\n- item 26"
        let second = document.update(source: secondSource, isStreaming: true)
        guard case .unorderedList(let secondItems) = second.parts[0].block.content else {
            Issue.record("Expected growing list")
            return
        }

        #expect(first.parts.count == 1)
        #expect(second.parts.count == 1)
        #expect(Array(secondItems.prefix(25)).map(\.id) == firstItems.map(\.id))
        #expect(secondItems[25].id != firstItems[24].id)
    }
}

private func completed(_ source: String) -> MarkdownRenderSnapshot {
    var document = IncrementalMarkdownDocument()
    return document.update(source: source, isStreaming: false)
}

private func renderedText(in snapshot: MarkdownRenderSnapshot) -> String {
    snapshot.parts.flatMap { part -> [String] in
        guard case .prose(let paragraphs) = part.block.content else {
            return []
        }
        return paragraphs.map { String($0.content.characters) }
    }.joined()
}
