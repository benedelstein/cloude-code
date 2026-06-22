import Foundation

final class ChunkedTextRenderCache {
    private var textCachesByPartKey: [String: ChunkedTextChunkCache] = [:]
    private let maxLineBreaksPerChunk: Int
    private let maxChunkUTF16Length: Int
    private let softBoundaryLookbackUTF16Length: Int
    private let minimumSoftBoundaryUTF16Length: Int

    init(
        maxLineBreaksPerChunk: Int = 5,
        maxChunkUTF16Length: Int = 2_400,
        softBoundaryLookbackUTF16Length: Int = 600,
        minimumSoftBoundaryUTF16Length: Int = 800
    ) {
        self.maxLineBreaksPerChunk = max(1, maxLineBreaksPerChunk)
        self.maxChunkUTF16Length = max(1, maxChunkUTF16Length)
        self.softBoundaryLookbackUTF16Length = max(0, softBoundaryLookbackUTF16Length)
        self.minimumSoftBoundaryUTF16Length = max(0, minimumSoftBoundaryUTF16Length)
    }

    func renderItems(
        from items: [AgentSessionRenderItem]
    ) -> [AgentSessionRenderItem] {
        items.map { item in
            guard case .text(let textItem) = item else {
                return item
            }

            let cache = textCachesByPartKey[textItem.key] ?? ChunkedTextChunkCache(
                maxLineBreaksPerChunk: maxLineBreaksPerChunk,
                maxChunkUTF16Length: maxChunkUTF16Length,
                softBoundaryLookbackUTF16Length: softBoundaryLookbackUTF16Length,
                minimumSoftBoundaryUTF16Length: minimumSoftBoundaryUTF16Length
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
    // UTF-16 offsets let us scan newly appended text without repeatedly walking
    // Swift Character indices across the full response.
    private var scannedUTF16Offset = 0
    private var lineBreakUTF16Offsets: [Int] = []
    // Index into lineBreakUTF16Offsets, not a UTF-16 text offset.
    private var nextLineBreakIndex = 0

    // Finalized chunks are stable SwiftUI Text inputs. Only the last tail chunk
    // is replaced as more streaming text arrives.
    private var finalizedChunks: [ChunkedTextChunk] = []
    private var nextChunkStartUTF16Offset = 0
    private let maxLineBreaksPerChunk: Int
    private let maxChunkUTF16Length: Int
    private let softBoundaryLookbackUTF16Length: Int
    private let minimumSoftBoundaryUTF16Length: Int

    init(
        maxLineBreaksPerChunk: Int,
        maxChunkUTF16Length: Int,
        softBoundaryLookbackUTF16Length: Int,
        minimumSoftBoundaryUTF16Length: Int
    ) {
        self.maxLineBreaksPerChunk = maxLineBreaksPerChunk
        self.maxChunkUTF16Length = maxChunkUTF16Length
        self.softBoundaryLookbackUTF16Length = softBoundaryLookbackUTF16Length
        self.minimumSoftBoundaryUTF16Length = minimumSoftBoundaryUTF16Length
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
            if utf16[index] == UTF16Character.lineFeed {
                lineBreakUTF16Offsets.append(offset)
            }
            offset += 1
            utf16.formIndex(after: &index)
        }
    }

    private func finalizeStableChunks(in text: String) {
        let totalUTF16Count = text.utf16.count

        while let stableBoundary = nextStableBoundary(
            in: text,
            startOffset: nextChunkStartUTF16Offset,
            totalUTF16Count: totalUTF16Count
        ) {
            let boundary = stableBoundary.boundary
            let startOffset = nextChunkStartUTF16Offset
            guard boundary.offset >= startOffset, boundary.offset <= totalUTF16Count else {
                return
            }

            let chunkText: String
            if boundary.offset > startOffset {
                chunkText = text.substring(utf16Offsets: startOffset..<boundary.offset)
            } else if boundary.skipsTrailingDelimiter {
                // Preserve an otherwise empty newline-delimited chunk after stripping
                // the delimiter so blank lines still produce stable rendered space.
                chunkText = " "
            } else {
                chunkText = ""
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
            nextLineBreakIndex = stableBoundary.nextLineBreakIndex
                ?? lineBreakIndex(afterConsumingTextBefore: nextChunkStartUTF16Offset)
        }
    }

    private func nextStableBoundary(
        in text: String,
        startOffset: Int,
        totalUTF16Count: Int
    ) -> StableBoundary? {
        let hardBoundary = min(startOffset + maxChunkUTF16Length, totalUTF16Count)

        // This pass can finalize chunks before they hit the max length, so it
        // only accepts a full newline batch. Accepting partial batches here
        // would make streaming line-heavy output finalize one chunk per line.
        if let lineBreakBoundary = batchedLineBreakBoundary(
            from: nextLineBreakIndex,
            hardBoundary: hardBoundary
        ) {
            return lineBreakBoundary
        }

        // If the chunk is under the max length and no line-break boundary is
        // ready, keep it active rather than finalizing it.
        guard totalUTF16Count - startOffset > maxChunkUTF16Length else {
            return nil
        }

        // Once the active chunk is too long, partial newline batches are fine:
        // at that point a natural boundary is better than a hard-cap split.
        return preferredBoundary(in: text, startOffset: startOffset, hardBoundary: hardBoundary)
    }

    private func batchedLineBreakBoundary(
        from lastLineBreakIndex: Int,
        hardBoundary: Int
    ) -> StableBoundary? {
        var boundaryLineBreakIndex = lastLineBreakIndex + maxLineBreaksPerChunk - 1
        guard boundaryLineBreakIndex < lineBreakUTF16Offsets.count else {
            return nil
        }

        // A full batch exists, but it may run past the hard cap. Walk back to
        // the largest newline batch that keeps the finalized chunk under cap.
        while boundaryLineBreakIndex >= lastLineBreakIndex,
              lineBreakUTF16Offsets[boundaryLineBreakIndex] > hardBoundary {
            boundaryLineBreakIndex -= 1
        }

        guard boundaryLineBreakIndex >= lastLineBreakIndex else {
            return nil
        }

        let boundaryOffset = lineBreakUTF16Offsets[boundaryLineBreakIndex]

        return (
            boundary: .init(
                offset: boundaryOffset,
                // Strip the trailing \n from the chunk text.
                skipsTrailingDelimiter: true,
                // Newline splits do not need leading horizontal whitespace trim.
                trimsFollowingHorizontalWhitespace: false
            ),
            nextLineBreakIndex: boundaryLineBreakIndex + 1
        )
    }

    private func preferredBoundary(
        in text: String,
        startOffset: Int,
        hardBoundary: Int
    ) -> StableBoundary? {
        guard hardBoundary > startOffset else {
            return nil
        }

        let lowerBound = max(
            startOffset + minimumSoftBoundaryUTF16Length,
            hardBoundary - softBoundaryLookbackUTF16Length
        )

        guard lowerBound < hardBoundary else {
            return (hardBoundaryFallback(at: hardBoundary), nil)
        }

        return nearestSoftBoundary(
            in: text,
            lowerBound: lowerBound,
            hardBoundary: hardBoundary
        ) ?? (hardBoundaryFallback(at: hardBoundary), nil)
    }

    private func nearestSoftBoundary(
        in text: String,
        lowerBound: Int,
        hardBoundary: Int
    ) -> StableBoundary? {
        let utf16 = text.utf16
        var sentenceBoundary: ChunkBoundary?
        var whitespaceBoundary: ChunkBoundary?
        var offset = hardBoundary
        var index = utf16.index(utf16.startIndex, offsetBy: hardBoundary)

        while offset > lowerBound {
            utf16.formIndex(before: &index)
            offset -= 1

            let value = utf16[index]
            switch value {
            case UTF16Character.lineFeed:
                // Reaching this scan means the chunk already exceeded the max
                // length and the eager full-batch newline path did not apply.
                // Use the best partial newline boundary instead of splitting
                // mid-line at the hard cap.
                return (
                    boundary: .init(
                        offset: offset,
                        skipsTrailingDelimiter: true,
                        trimsFollowingHorizontalWhitespace: false
                    ),
                    nextLineBreakIndex: lineBreakIndex(afterConsumingTextBefore: offset + 1)
                )
            case _ where UTF16Character.isSentencePunctuation(value):
                if sentenceBoundary == nil {
                    sentenceBoundary = expandedSentenceBoundaryOffset(
                        in: text,
                        afterPunctuationAt: offset,
                        hardBoundary: hardBoundary
                    )
                }
            case _ where UTF16Character.isHorizontalWhitespace(value):
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

        return (sentenceBoundary ?? whitespaceBoundary).map { ($0, nil) }
    }

    private func hardBoundaryFallback(at offset: Int) -> ChunkBoundary {
        .init(
            offset: offset,
            skipsTrailingDelimiter: false,
            trimsFollowingHorizontalWhitespace: false
        )
    }
}

private extension ChunkedTextChunkCache {
    private func lineBreakIndex(afterConsumingTextBefore utf16Offset: Int) -> Int {
        var lineBreakIndex = nextLineBreakIndex
        while lineBreakIndex < lineBreakUTF16Offsets.count,
              lineBreakUTF16Offsets[lineBreakIndex] < utf16Offset {
            lineBreakIndex += 1
        }
        return lineBreakIndex
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
            // Trim whitespace from the start of the next chunk so it doesn't render like:
            // "   Foo..."
            let index = utf16.index(utf16.startIndex, offsetBy: offset)
            guard UTF16Character.isHorizontalWhitespace(utf16[index]) else {
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
            guard UTF16Character.isClosingSentenceDelimiter(utf16[index]) else {
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

private struct ChunkBoundary {
    // End offset for the next finalized chunk. The start offset is the cache's
    // current nextChunkStartUTF16Offset.
    let offset: Int
    let skipsTrailingDelimiter: Bool
    let trimsFollowingHorizontalWhitespace: Bool
}

private typealias StableBoundary = (boundary: ChunkBoundary, nextLineBreakIndex: Int?)

private enum UTF16Character {
    static let horizontalTab: UInt16 = 9
    static let lineFeed: UInt16 = 10
    static let space: UInt16 = 32
    static let doubleQuote: UInt16 = 34
    static let apostrophe: UInt16 = 39
    static let closingParenthesis: UInt16 = 41
    static let exclamationMark: UInt16 = 33
    static let period: UInt16 = 46
    static let questionMark: UInt16 = 63
    static let closingSquareBracket: UInt16 = 93
    static let closingCurlyBrace: UInt16 = 125
    static let rightSingleQuotationMark: UInt16 = 8217
    static let rightDoubleQuotationMark: UInt16 = 8221

    static func isSentencePunctuation(_ value: UInt16) -> Bool {
        value == period || value == exclamationMark || value == questionMark
    }

    static func isClosingSentenceDelimiter(_ value: UInt16) -> Bool {
        switch value {
        case doubleQuote,
             apostrophe,
             closingParenthesis,
             closingSquareBracket,
             closingCurlyBrace,
             rightSingleQuotationMark,
             rightDoubleQuotationMark:
            true
        default:
            false
        }
    }

    static func isHorizontalWhitespace(_ value: UInt16) -> Bool {
        value == space || value == horizontalTab
    }
}

private extension String {
    func substring(utf16Offsets offsets: Range<Int>) -> String {
        let start = String.Index(utf16Offset: offsets.lowerBound, in: self)
        let end = String.Index(utf16Offset: offsets.upperBound, in: self)
        return String(self[start..<end])
    }
}
