@testable import CloudeCode
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
