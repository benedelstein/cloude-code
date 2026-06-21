@testable import CloudeCode
import Testing

@Suite("Chunked text render cache")
struct ChunkedTextRenderCacheTests {
    @Test func batchesFiveLineBreaksIntoOneChunk() {
        let chunks = renderChunks(for: "one\ntwo\nthree\nfour\nfive\nsix")

        #expect(chunks.map(\.text) == [
            "one\ntwo\nthree\nfour\nfive",
            "six"
        ])
    }

    @Test func keepsInternalLineBreaksAndPreservesBlankLineAfterBoundary() {
        let chunks = renderChunks(for: "one\ntwo\nthree\nfour\nfive\n\nseven")

        #expect(chunks.map(\.text) == [
            "one\ntwo\nthree\nfour\nfive",
            "\nseven"
        ])
    }

    @Test func prefersSentenceBoundaryBeforeHardCap() {
        let text = String(repeating: "a", count: 2_250)
            + ". "
            + String(repeating: "b", count: 400)

        let chunks = renderChunks(for: text)

        #expect(chunks.count == 2)
        #expect(chunks[0].text == String(repeating: "a", count: 2_250) + ".")
        #expect(chunks[1].text == String(repeating: "b", count: 400))
    }

    @Test func keepsClosingQuoteWithSentenceBoundary() {
        let text = String(repeating: "a", count: 2_250)
            + ".\" "
            + String(repeating: "b", count: 400)

        let chunks = renderChunks(for: text)

        #expect(chunks.count == 2)
        #expect(chunks[0].text == String(repeating: "a", count: 2_250) + ".\"")
        #expect(chunks[1].text == String(repeating: "b", count: 400))
    }

    @Test func prefersWhitespaceBoundaryBeforeHardCap() {
        let text = String(repeating: "a", count: 2_250)
            + " "
            + String(repeating: "b", count: 400)

        let chunks = renderChunks(for: text)

        #expect(chunks.count == 2)
        #expect(chunks[0].text == String(repeating: "a", count: 2_250) + " ")
        #expect(chunks[1].text == String(repeating: "b", count: 400))
    }

    @Test func fallsBackToHardCapWithoutNearbyNaturalBoundary() {
        let text = String(repeating: "a", count: 2_650)

        let chunks = renderChunks(for: text)

        #expect(chunks.count == 2)
        #expect(chunks[0].text.count == 2_400)
        #expect(chunks[1].text.count == 250)
    }
}

private func renderChunks(for text: String) -> [ChunkedTextChunk] {
    let cache = ChunkedTextRenderCache(maxLineBreaksPerChunk: 5)
    let items = cache.renderItems(from: [
        .text(.init(key: "message-text-0", text: text))
    ])

    guard case .chunkedText(let item) = items.first else {
        Issue.record("Expected chunked text item")
        return []
    }

    return item.chunks
}
