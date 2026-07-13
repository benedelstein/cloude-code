@testable import CloudeCode
import Domain
import MarkdownParsing
import Testing

@Suite("Markdown render cache")
struct MarkdownRenderCacheTests {
    @Test func convertsTextItemsToMarkdownWhileRetainingRawText() {
        let cache = MarkdownRenderCache()
        let source = "# Heading\n\n- one\n- two"

        let items = cache.renderItems(
            from: [.text(.init(key: "message-text-0", text: source))],
            isStreaming: false
        )

        guard case .markdown(let item) = items.first else {
            Issue.record("Expected Markdown item")
            return
        }
        #expect(item.text == source)
        #expect(item.parts.map(\.source).joined() == source)
        #expect(item.parts.count == 2)
    }

    @Test func independentItemKeysKeepIndependentDocuments() {
        let cache = MarkdownRenderCache(maximumParagraphsPerPart: 1)

        let first = renderParts(cache: cache, key: "first", text: "One\n\nTwo", isStreaming: true)
        let second = renderParts(cache: cache, key: "second", text: "Alpha", isStreaming: true)
        let updated = renderParts(cache: cache, key: "first", text: "One\n\nTwo updated", isStreaming: true)

        #expect(first.map(\.source).joined() == "One\n\nTwo")
        #expect(second.map(\.source).joined() == "Alpha")
        #expect(updated.map(\.source).joined() == "One\n\nTwo updated")
        #expect(first.first?.id == updated.first?.id)
    }

    @Test func completionFinalizesTheActiveTail() {
        let cache = MarkdownRenderCache()
        let streaming = renderParts(cache: cache, text: "Still streaming", isStreaming: true)
        let completed = renderParts(cache: cache, text: "Still streaming", isStreaming: false)

        #expect(streaming.allSatisfy { $0.stability == .active })
        #expect(completed.allSatisfy { $0.stability == .finalized })
    }

    @Test func nonTextItemsPassThroughAndMixedItemsKeepOrder() {
        let cache = MarkdownRenderCache()
        let reasoning = AgentSessionRenderItem.reasoning(.init(
            key: "reasoning-0",
            part: .init(text: "Thinking")
        ))
        let items: [AgentSessionRenderItem] = [
            .text(.init(key: "text-0", text: "# First")),
            reasoning,
            .text(.init(key: "text-1", text: "Second"))
        ]

        let rendered = cache.renderItems(from: items, isStreaming: false)

        #expect(rendered.map(\.key) == ["text-0", "reasoning-0", "text-1"])
        guard case .markdown = rendered[0],
              rendered[1] == reasoning,
              case .markdown = rendered[2] else {
            Issue.record("Expected text conversion with reasoning passed through")
            return
        }
    }

    @Test func resetDiscardsAllCachedDocuments() {
        let cache = MarkdownRenderCache()
        _ = renderParts(cache: cache, key: "first", text: "First", isStreaming: true)
        _ = renderParts(cache: cache, key: "second", text: "Second", isStreaming: true)
        #expect(cache.cachedDocumentCount == 2)

        cache.reset()

        #expect(cache.cachedDocumentCount == 0)
    }

    @Test func replacementAndShrinkFlowThroughCacheBoundary() {
        let cache = MarkdownRenderCache()
        _ = renderParts(cache: cache, text: "First\n\nSecond", isStreaming: true)

        let replaced = renderParts(cache: cache, text: "Other\n\nSecond", isStreaming: true)
        let shrunk = renderParts(cache: cache, text: "Short", isStreaming: true)

        #expect(replaced.map(\.source).joined() == "Other\n\nSecond")
        #expect(replaced.first?.id.utf16SourceOffset == 0)
        #expect(shrunk.map(\.source).joined() == "Short")
        #expect(shrunk.first?.id.utf16SourceOffset == 0)
    }
}

private func renderParts(
    cache: MarkdownRenderCache,
    key: String = "message-text-0",
    text: String,
    isStreaming: Bool
) -> [MarkdownPart] {
    let items = cache.renderItems(
        from: [.text(.init(key: key, text: text))],
        isStreaming: isStreaming
    )
    guard case .markdown(let item) = items.first else {
        Issue.record("Expected Markdown item")
        return []
    }
    return item.parts
}
