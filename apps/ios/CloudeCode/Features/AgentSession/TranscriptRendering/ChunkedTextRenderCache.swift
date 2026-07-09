import Foundation

/// Converts raw assistant text render items into stable markdown transcript parts.
///
/// Strategy: each text item keeps a finalized prefix (parsed once, never touched again)
/// and an active tail that re-parses every tick. Parts finalize at complete code fences,
/// batches of blank lines, or an unconditional hard length cap — see
/// `docs/markdown-chunking.md` for boundary rules and the accepted performance trade-offs.
final class ChunkedTextRenderCache {
    private var textCachesByPartKey: [String: MarkdownTextPartCache] = [:]
    private let maxActiveTextUTF16Length: Int
    private let softBoundaryLookbackUTF16Length: Int
    private let minimumSoftBoundaryUTF16Length: Int
    private let maxParagraphsPerPart: Int

    /// Creates a cache that bounds repeated parsing of active rich-text tails.
    init(
        maxChunkUTF16Length: Int = 2_400,
        softBoundaryLookbackUTF16Length: Int = 600,
        minimumSoftBoundaryUTF16Length: Int = 800,
        maxParagraphsPerPart: Int = 5
    ) {
        maxActiveTextUTF16Length = max(1, maxChunkUTF16Length)
        self.softBoundaryLookbackUTF16Length = max(0, softBoundaryLookbackUTF16Length)
        self.minimumSoftBoundaryUTF16Length = max(0, minimumSoftBoundaryUTF16Length)
        self.maxParagraphsPerPart = max(1, maxParagraphsPerPart)
    }

    /// Returns render items with assistant text converted to structured markdown parts.
    func renderItems(
        from items: [AgentSessionRenderItem]
    ) -> [AgentSessionRenderItem] {
        items.map { item in
            guard case .text(let textItem) = item else {
                return item
            }

            let cache = textCachesByPartKey[textItem.key] ?? MarkdownTextPartCache(
                maxActiveTextUTF16Length: maxActiveTextUTF16Length,
                softBoundaryLookbackUTF16Length: softBoundaryLookbackUTF16Length,
                minimumSoftBoundaryUTF16Length: minimumSoftBoundaryUTF16Length,
                maxParagraphsPerPart: maxParagraphsPerPart
            )
            textCachesByPartKey[textItem.key] = cache

            return .chunkedText(.init(
                key: textItem.key,
                text: textItem.text,
                parts: cache.parts(for: textItem.text)
            ))
        }
    }

    /// Clears all per-text-item markdown render caches.
    func reset() {
        textCachesByPartKey = [:]
    }
}

private final class MarkdownTextPartCache {
    private var previousText = ""
    private var previousUTF16Count = 0
    private var activeStartUTF16Offset = 0
    private var finalizedParts: [MarkdownTextPart] = []
    private var nextPartID = 0

    private let maxActiveTextUTF16Length: Int
    private let softBoundaryLookbackUTF16Length: Int
    private let minimumSoftBoundaryUTF16Length: Int
    private let maxParagraphsPerPart: Int

    init(
        maxActiveTextUTF16Length: Int,
        softBoundaryLookbackUTF16Length: Int,
        minimumSoftBoundaryUTF16Length: Int,
        maxParagraphsPerPart: Int
    ) {
        self.maxActiveTextUTF16Length = maxActiveTextUTF16Length
        self.softBoundaryLookbackUTF16Length = softBoundaryLookbackUTF16Length
        self.minimumSoftBoundaryUTF16Length = minimumSoftBoundaryUTF16Length
        self.maxParagraphsPerPart = maxParagraphsPerPart
    }

    func parts(for text: String) -> [MarkdownTextPart] {
        let totalUTF16Count = text.utf16.count
        if shouldReset(for: text, totalUTF16Count: totalUTF16Count) {
            reset()
        }

        previousText = text
        previousUTF16Count = totalUTF16Count
        finalizeStableParts(in: text)
        return finalizedParts + activeParts(in: text)
    }

    private func shouldReset(for text: String, totalUTF16Count: Int) -> Bool {
        guard previousUTF16Count > 0 || !previousText.isEmpty else {
            return false
        }
        if totalUTF16Count < previousUTF16Count {
            return true
        }
        if totalUTF16Count == previousUTF16Count {
            return text != previousText
        }
        return false
    }

    private func reset() {
        previousText = ""
        previousUTF16Count = 0
        activeStartUTF16Offset = 0
        finalizedParts = []
        nextPartID = 0
    }

    private func finalizeStableParts(in text: String) {
        let totalUTF16Count = text.utf16.count

        while activeStartUTF16Offset < totalUTF16Count {
            guard let segment = MarkdownTextSegmenter.nextSegment(in: text, from: activeStartUTF16Offset) else {
                return
            }

            switch segment {
            case .richText(let segment):
                guard finalizeRichText(in: segment.range, text: text) else {
                    return
                }
            case .codeBlock(let segment):
                // A fence that closes exactly at end of text is not frozen yet: the
                // closing line can still grow (```x un-closes it) and its trailing
                // linefeed has not arrived, so freezing now would leak that linefeed
                // into the next rich part as a stray blank line.
                guard segment.isComplete, segment.endOffset < totalUTF16Count else {
                    return
                }
                appendCodeBlock(
                    text.substring(utf16Offsets: segment.bodyRange),
                    language: segment.language,
                    isComplete: segment.isComplete
                )
                activeStartUTF16Offset = segment.endOffset
            }
        }
    }

    private func finalizeRichText(in range: Range<Int>, text: String) -> Bool {
        let allowsEndBoundary = range.upperBound < text.utf16.count
        guard let boundary = stableTextBoundary(
            in: text,
            upperBound: range.upperBound,
            allowsEndBoundary: allowsEndBoundary
        ) else {
            return false
        }

        appendRichText(text.substring(utf16Offsets: activeStartUTF16Offset..<boundary))
        activeStartUTF16Offset = boundary
        return true
    }

    /// Finds the furthest safe finalization boundary: a full batch of paragraphs ending
    /// at a blank line that passes the inline-safety check, else the hard length cap
    /// (soft whitespace boundary preferred, but the cap itself is unconditional so
    /// finalization always makes progress), else the segment end. The segment end is
    /// never a boundary at end of text (`allowsEndBoundary`), because trailing text may
    /// still grow.
    ///
    /// Blank lines under the batch size stay active: finalizing at every blank line
    /// would emit one part per paragraph, and parts are only worth their re-parse
    /// savings in multi-paragraph batches.
    private func stableTextBoundary(
        in text: String,
        upperBound: Int,
        allowsEndBoundary: Bool
    ) -> Int? {
        guard activeStartUTF16Offset < upperBound else {
            return nil
        }

        let exceedsHardCap = upperBound - activeStartUTF16Offset > maxActiveTextUTF16Length
        let scanUpperBound = min(activeStartUTF16Offset + maxActiveTextUTF16Length, upperBound)
        let blankLineBoundaries = blankLineBoundaries(
            in: text,
            upperBound: scanUpperBound,
            limit: maxParagraphsPerPart
        )
        if blankLineBoundaries.count >= maxParagraphsPerPart || (exceedsHardCap && !blankLineBoundaries.isEmpty) {
            for boundary in blankLineBoundaries.reversed() where canFinalizeText(in: text, boundary: boundary) {
                return boundary
            }
        }

        if exceedsHardCap {
            return hardLengthBoundary(in: text, upperBound: upperBound)
        }

        if allowsEndBoundary, canFinalizeText(in: text, boundary: upperBound) {
            return upperBound
        }

        return nil
    }

    private func blankLineBoundaries(in text: String, upperBound: Int, limit: Int) -> [Int] {
        let utf16 = text.utf16
        var boundaries: [Int] = []
        var previousWasLineFeed = false
        var offset = activeStartUTF16Offset
        var index = utf16.index(utf16.startIndex, offsetBy: activeStartUTF16Offset)

        while index < utf16.endIndex, offset < upperBound, boundaries.count < limit {
            let value = utf16[index]
            if value == UTF16Character.lineFeed {
                if previousWasLineFeed {
                    boundaries.append(offset + 1)
                    previousWasLineFeed = false
                } else {
                    previousWasLineFeed = true
                }
            } else if !UTF16Character.isHorizontalWhitespace(value) {
                previousWasLineFeed = false
            }

            offset += 1
            utf16.formIndex(after: &index)
        }

        return boundaries
    }

    private func hardLengthBoundary(in text: String, upperBound: Int) -> Int {
        let hardBoundary = min(activeStartUTF16Offset + maxActiveTextUTF16Length, upperBound)
        let lowerBound = max(
            activeStartUTF16Offset + minimumSoftBoundaryUTF16Length,
            hardBoundary - softBoundaryLookbackUTF16Length
        )
        guard lowerBound < hardBoundary else {
            return hardBoundary
        }

        let utf16 = text.utf16
        var offset = hardBoundary
        var index = utf16.index(utf16.startIndex, offsetBy: hardBoundary)
        while offset > lowerBound {
            utf16.formIndex(before: &index)
            offset -= 1
            let value = utf16[index]
            guard value == UTF16Character.lineFeed || UTF16Character.isHorizontalWhitespace(value) else {
                continue
            }
            if canFinalizeText(in: text, boundary: offset + 1) {
                return offset + 1
            }
        }

        return hardBoundary
    }

    private func canFinalizeText(in text: String, boundary: Int) -> Bool {
        let source = text.substring(utf16Offsets: activeStartUTF16Offset..<boundary)
        return !source.isEmpty && !MarkdownInlineState.hasUnsafeOpenConstruct(in: source)
    }

    private func activeParts(in text: String) -> [MarkdownTextPart] {
        MarkdownActivePartBuilder.parts(
            in: text,
            from: activeStartUTF16Offset,
            startingPartID: nextPartID
        )
    }

    private func appendRichText(_ source: String) {
        guard !source.isEmpty else { return }
        finalizedParts.append(MarkdownTextPartFactory.richTextPart(id: nextPartID, source: source))
        nextPartID += 1
    }

    private func appendCodeBlock(_ text: String, language: String?, isComplete: Bool) {
        finalizedParts.append(.codeBlock(.init(
            id: nextPartID,
            text: text,
            language: language,
            isComplete: isComplete
        )))
        nextPartID += 1
    }
}
