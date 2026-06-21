import Foundation

final class StreamingMessageRenderCache {
    private var textCachesByPartKey: [String: StreamingTextChunkCache] = [:]

    func renderItems(
        from items: [AgentSessionRenderItem]
    ) -> [AgentSessionRenderItem] {
        items.map { item in
            guard case .text(let textItem) = item else {
                return item
            }

            let cache = textCachesByPartKey[textItem.key] ?? StreamingTextChunkCache()
            textCachesByPartKey[textItem.key] = cache

            return .streamingText(.init(
                key: textItem.key,
                text: textItem.text,
                chunks: cache.chunks(for: textItem.text)
            ))
        }
    }

    func reset() {
        textCachesByPartKey = [:]
    }
}

private final class StreamingTextChunkCache {
    private static let maxChunkUTF16Length = 2_400

    // UTF-16 offsets let us scan newly appended text without repeatedly walking
    // Swift Character indices across the full response.
    private var scannedUTF16Offset = 0
    private var lineBreakUTF16Offsets: [Int] = []
    private var nextLineBreakIndex = 0

    // Finalized chunks are stable SwiftUI Text inputs. Only the last tail chunk
    // is replaced as more streaming text arrives.
    private var finalizedChunks: [StreamingTextChunk] = []
    private var nextChunkStartUTF16Offset = 0

    func chunks(for text: String) -> [StreamingTextChunk] {
        let totalUTF16Count = text.utf16.count
        if totalUTF16Count < scannedUTF16Offset {
            reset()
        }

        scanLineBreaks(in: text, from: scannedUTF16Offset)
        scannedUTF16Offset = totalUTF16Count
        finalizeStableChunks(in: text)
        return chunksSnapshot(in: text)
    }

    private func reset() {
        scannedUTF16Offset = 0
        lineBreakUTF16Offsets = []
        nextLineBreakIndex = 0
        finalizedChunks = []
        nextChunkStartUTF16Offset = 0
    }

    private func scanLineBreaks(in text: String, from startOffset: Int) {
        let utf16 = text.utf16
        guard startOffset < utf16.count else { return }

        var offset = startOffset
        var index = utf16.index(utf16.startIndex, offsetBy: startOffset)
        while index < utf16.endIndex {
            if utf16[index] == 10 {
                lineBreakUTF16Offsets.append(offset)
            }
            offset += 1
            utf16.formIndex(after: &index)
        }
    }

    private func finalizeStableChunks(in text: String) {
        let totalUTF16Count = text.utf16.count

        while let boundary = nextStableBoundary(totalUTF16Count: totalUTF16Count) {
            let startOffset = nextChunkStartUTF16Offset
            guard boundary >= startOffset, boundary <= totalUTF16Count else {
                return
            }

            let didSplitAtLineBreak = nextLineBreakIndex < lineBreakUTF16Offsets.count
                && lineBreakUTF16Offsets[nextLineBreakIndex] == boundary
            let chunkText = if boundary > startOffset {
                text.substring(utf16Offsets: startOffset..<boundary)
            } else if didSplitAtLineBreak {
                " "
            } else {
                ""
            }

            guard !chunkText.isEmpty else {
                return
            }

            finalizedChunks.append(StreamingTextChunk(
                id: finalizedChunks.count,
                text: chunkText
            ))

            nextChunkStartUTF16Offset = didSplitAtLineBreak ? boundary + 1 : boundary

            while nextLineBreakIndex < lineBreakUTF16Offsets.count,
                  lineBreakUTF16Offsets[nextLineBreakIndex] < nextChunkStartUTF16Offset {
                nextLineBreakIndex += 1
            }
        }
    }

    private func nextStableBoundary(totalUTF16Count: Int) -> Int? {
        let startOffset = nextChunkStartUTF16Offset
        let hardBoundary = min(startOffset + Self.maxChunkUTF16Length, totalUTF16Count)

        // Finalize every complete line as soon as its newline arrives. For
        // unbroken output, fall back to a hard cap so the tail cannot grow into
        // one giant Text.
        if nextLineBreakIndex < lineBreakUTF16Offsets.count {
            let lineBreakBoundary = lineBreakUTF16Offsets[nextLineBreakIndex]
            return lineBreakBoundary <= hardBoundary ? lineBreakBoundary : hardBoundary
        }

        return totalUTF16Count - startOffset > Self.maxChunkUTF16Length ? hardBoundary : nil
    }

    private func chunksSnapshot(in text: String) -> [StreamingTextChunk] {
        let totalUTF16Count = text.utf16.count
        let tailStartOffset = nextChunkStartUTF16Offset
        var chunks = finalizedChunks

        // The tail uses a stable id equal to finalizedChunks.count. Replacing its
        // text is cheaper than replacing one giant Text for the entire response.
        if tailStartOffset < totalUTF16Count {
            chunks.append(StreamingTextChunk(
                id: finalizedChunks.count,
                text: text.substring(utf16Offsets: tailStartOffset..<totalUTF16Count)
            ))
        }

        return chunks
    }
}

private extension String {
    func substring(utf16Offsets offsets: Range<Int>) -> String {
        let start = String.Index(utf16Offset: offsets.lowerBound, in: self)
        let end = String.Index(utf16Offset: offsets.upperBound, in: self)
        return String(self[start..<end])
    }
}
