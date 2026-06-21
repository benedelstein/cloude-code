import Foundation

final class ChunkedTextRenderCache {
    private var textCachesByPartKey: [String: ChunkedTextChunkCache] = [:]
    private let maxLineBreaksPerChunk: Int

    init(maxLineBreaksPerChunk: Int = 5) {
        self.maxLineBreaksPerChunk = max(1, maxLineBreaksPerChunk)
    }

    func renderItems(
        from items: [AgentSessionRenderItem]
    ) -> [AgentSessionRenderItem] {
        items.map { item in
            guard case .text(let textItem) = item else {
                return item
            }

            let cache = textCachesByPartKey[textItem.key] ?? ChunkedTextChunkCache(
                maxLineBreaksPerChunk: maxLineBreaksPerChunk
            )
            textCachesByPartKey[textItem.key] = cache

            return .chunkedText(.init(
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

// FUTURE OPTIMIZATION - CHUNK INTO ATTRIBUTED STRINGS INSTEAD OF RAW STRINGS
// SUPPORT MARKDOWN RENDERING
// POSSIBLY PRECOMPUTE TEXT BOUNDS FROM THE ATTRIBUTED STRING FOR FASTER LAYOUT.
private final class ChunkedTextChunkCache {
    private static let maxChunkUTF16Length = 2_400
    private static let softBoundaryLookbackUTF16Length = 600
    private static let minimumSoftBoundaryUTF16Length = 800

    private struct ChunkBoundary {
        let offset: Int
        let skipsTrailingDelimiter: Bool
        let trimsFollowingHorizontalWhitespace: Bool
    }

    // UTF-16 offsets let us scan newly appended text without repeatedly walking
    // Swift Character indices across the full response.
    private var scannedUTF16Offset = 0
    private var lineBreakUTF16Offsets: [Int] = []
    private var nextLineBreakIndex = 0

    // Finalized chunks are stable SwiftUI Text inputs. Only the last tail chunk
    // is replaced as more streaming text arrives.
    private var finalizedChunks: [ChunkedTextChunk] = []
    private var nextChunkStartUTF16Offset = 0
    private let maxLineBreaksPerChunk: Int

    init(maxLineBreaksPerChunk: Int) {
        self.maxLineBreaksPerChunk = maxLineBreaksPerChunk
    }

    func chunks(for text: String) -> [ChunkedTextChunk] {
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

        while let boundary = nextStableBoundary(in: text, totalUTF16Count: totalUTF16Count) {
            let startOffset = nextChunkStartUTF16Offset
            guard boundary.offset >= startOffset, boundary.offset <= totalUTF16Count else {
                return
            }

            let chunkText = if boundary.offset > startOffset {
                text.substring(utf16Offsets: startOffset..<boundary.offset)
            } else if boundary.skipsTrailingDelimiter {
                " "
            } else {
                ""
            }

            guard !chunkText.isEmpty else {
                return
            }

            finalizedChunks.append(ChunkedTextChunk(
                id: finalizedChunks.count,
                text: chunkText
            ))

            nextChunkStartUTF16Offset = nextStartOffset(
                after: boundary,
                in: text,
                totalUTF16Count: totalUTF16Count
            )

            while nextLineBreakIndex < lineBreakUTF16Offsets.count,
                  lineBreakUTF16Offsets[nextLineBreakIndex] < nextChunkStartUTF16Offset {
                nextLineBreakIndex += 1
            }
        }
    }

    private func nextStableBoundary(
        in text: String,
        totalUTF16Count: Int
    ) -> ChunkBoundary? {
        let startOffset = nextChunkStartUTF16Offset
        let hardBoundary = min(startOffset + Self.maxChunkUTF16Length, totalUTF16Count)

        // Batch complete lines so line-heavy output does not create one SwiftUI
        // Text per line. The trailing newline is a delimiter; internal newlines
        // stay inside the chunk.
        if let lineBreakBoundary = batchedLineBreakBoundary(), lineBreakBoundary <= hardBoundary {
            return .init(
                offset: lineBreakBoundary,
                skipsTrailingDelimiter: true,
                trimsFollowingHorizontalWhitespace: false
            )
        }

        guard totalUTF16Count - startOffset > Self.maxChunkUTF16Length else {
            return nil
        }

        return preferredBoundary(in: text, startOffset: startOffset, hardBoundary: hardBoundary)
    }

    private func batchedLineBreakBoundary() -> Int? {
        let boundaryLineBreakIndex = nextLineBreakIndex + maxLineBreaksPerChunk - 1
        guard boundaryLineBreakIndex < lineBreakUTF16Offsets.count else {
            return nil
        }

        return lineBreakUTF16Offsets[boundaryLineBreakIndex]
    }

    private func preferredBoundary(
        in text: String,
        startOffset: Int,
        hardBoundary: Int
    ) -> ChunkBoundary {
        guard hardBoundary > startOffset else {
            return hardBoundaryFallback(at: hardBoundary)
        }

        let lowerBound = max(
            startOffset + Self.minimumSoftBoundaryUTF16Length,
            hardBoundary - Self.softBoundaryLookbackUTF16Length
        )

        guard lowerBound < hardBoundary else {
            return hardBoundaryFallback(at: hardBoundary)
        }

        return nearestSoftBoundary(
            in: text,
            lowerBound: lowerBound,
            hardBoundary: hardBoundary
        ) ?? hardBoundaryFallback(at: hardBoundary)
    }

    private func nearestSoftBoundary(
        in text: String,
        lowerBound: Int,
        hardBoundary: Int
    ) -> ChunkBoundary? {
        let utf16 = text.utf16
        var sentenceBoundary: ChunkBoundary?
        var whitespaceBoundary: ChunkBoundary?
        var offset = hardBoundary
        var index = utf16.index(utf16.startIndex, offsetBy: hardBoundary)

        while offset > lowerBound {
            utf16.formIndex(before: &index)
            offset -= 1

            switch utf16[index] {
            case 10:
                return .init(
                    offset: offset,
                    skipsTrailingDelimiter: true,
                    trimsFollowingHorizontalWhitespace: false
                )
            case 46, 33, 63:
                if sentenceBoundary == nil {
                    sentenceBoundary = expandedSentenceBoundaryOffset(
                        in: text,
                        afterPunctuationAt: offset,
                        hardBoundary: hardBoundary
                    )
                }
            case 32, 9:
                if whitespaceBoundary == nil {
                    whitespaceBoundary = .init(
                        offset: offset + 1,
                        skipsTrailingDelimiter: false,
                        trimsFollowingHorizontalWhitespace: false
                    )
                }
            default:
                continue
            }
        }

        return sentenceBoundary ?? whitespaceBoundary
    }

    private func hardBoundaryFallback(at offset: Int) -> ChunkBoundary {
        .init(
            offset: offset,
            skipsTrailingDelimiter: false,
            trimsFollowingHorizontalWhitespace: false
        )
    }

    private func nextStartOffset(
        after boundary: ChunkBoundary,
        in text: String,
        totalUTF16Count: Int
    ) -> Int {
        var offset = boundary.skipsTrailingDelimiter ? boundary.offset + 1 : boundary.offset
        guard boundary.trimsFollowingHorizontalWhitespace else {
            return offset
        }

        let utf16 = text.utf16
        while offset < totalUTF16Count {
            let index = utf16.index(utf16.startIndex, offsetBy: offset)
            guard utf16[index].isHorizontalWhitespace else {
                break
            }
            offset += 1
        }

        return offset
    }

    private func expandedSentenceBoundaryOffset(
        in text: String,
        afterPunctuationAt punctuationOffset: Int,
        hardBoundary: Int
    ) -> ChunkBoundary {
        var offset = punctuationOffset + 1
        let utf16 = text.utf16

        while offset < hardBoundary {
            let index = utf16.index(utf16.startIndex, offsetBy: offset)
            guard utf16[index].isClosingSentenceDelimiter else {
                break
            }
            offset += 1
        }

        return .init(
            offset: offset,
            skipsTrailingDelimiter: false,
            trimsFollowingHorizontalWhitespace: true
        )
    }

    private func chunksSnapshot(in text: String) -> [ChunkedTextChunk] {
        let totalUTF16Count = text.utf16.count
        let tailStartOffset = nextChunkStartUTF16Offset
        var chunks = finalizedChunks

        // The tail uses a stable id equal to finalizedChunks.count. Replacing its
        // text is cheaper than replacing one giant Text for the entire response.
        if tailStartOffset < totalUTF16Count {
            chunks.append(ChunkedTextChunk(
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

private extension UInt16 {
    var isClosingSentenceDelimiter: Bool {
        switch self {
        case 34, 39, 41, 93, 125, 8217, 8221:
            true
        default:
            false
        }
    }

    var isHorizontalWhitespace: Bool {
        self == 32 || self == 9
    }
}
