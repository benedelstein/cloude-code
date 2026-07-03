import Foundation

/// Finds CommonMark fenced code block lines in transcript source.
enum MarkdownFenceScanner {
    /// Finds the first opening fence whose marker begins at a true line start.
    static func openingFence(in text: String, from startOffset: Int) -> MarkdownFence? {
        guard let line = firstFenceLine(in: text, from: startOffset) else {
            return nil
        }

        return .init(
            startOffset: line.startOffset,
            bodyStartOffset: line.endIncludingLineFeedOffset,
            marker: line.fence.marker,
            markerLength: line.fence.markerLength,
            language: line.fence.info
        )
    }

    /// Finds the matching closing fence for an opening fence.
    static func closedFence(opening: MarkdownFence, in text: String) -> ClosedMarkdownFence? {
        guard let line = firstFenceLine(in: text, from: opening.bodyStartOffset, matching: { fence in
            fence.marker == opening.marker
                && fence.markerLength >= opening.markerLength
                && fence.info == nil
        }) else {
            return nil
        }

        return .init(
            bodyRange: opening.bodyStartOffset..<max(
                opening.bodyStartOffset,
                strippingTrailingLineFeed(before: line.startOffset, in: text)
            ),
            endOffset: line.endIncludingLineFeedOffset
        )
    }

    private static func strippingTrailingLineFeed(before offset: Int, in text: String) -> Int {
        guard offset > 0 else {
            return offset
        }

        let utf16 = text.utf16
        let previousIndex = utf16.index(utf16.startIndex, offsetBy: offset - 1)
        return utf16[previousIndex] == UTF16Character.lineFeed ? offset - 1 : offset
    }

    private static func firstFenceLine(
        in text: String,
        from startOffset: Int,
        matching predicate: (MarkdownFenceLine) -> Bool = { _ in true }
    ) -> MarkdownScannedFenceLine? {
        guard var lineStart = firstTrueLineStart(in: text, from: startOffset) else {
            return nil
        }

        let totalUTF16Count = text.utf16.count
        let utf16 = text.utf16
        while lineStart < totalUTF16Count {
            let lineEnd = lineEndOffset(in: utf16, from: lineStart)
            let endIncludingLineFeedOffset = min(lineEnd + 1, totalUTF16Count)
            if let fence = fenceLine(in: text, startOffset: lineStart, endOffset: lineEnd),
               predicate(fence) {
                return .init(
                    startOffset: lineStart,
                    endIncludingLineFeedOffset: endIncludingLineFeedOffset,
                    fence: fence
                )
            }

            guard endIncludingLineFeedOffset > lineStart else {
                return nil
            }
            lineStart = endIncludingLineFeedOffset
        }
        return nil
    }

    private static func firstTrueLineStart(in text: String, from startOffset: Int) -> Int? {
        let totalUTF16Count = text.utf16.count
        guard startOffset < totalUTF16Count else {
            return nil
        }
        guard startOffset > 0 else {
            return 0
        }

        let utf16 = text.utf16
        let previousIndex = utf16.index(utf16.startIndex, offsetBy: startOffset - 1)
        if utf16[previousIndex] == UTF16Character.lineFeed {
            return startOffset
        }

        var offset = startOffset
        var index = utf16.index(utf16.startIndex, offsetBy: startOffset)
        while index < utf16.endIndex {
            if utf16[index] == UTF16Character.lineFeed {
                let nextLineStart = offset + 1
                return nextLineStart < totalUTF16Count ? nextLineStart : nil
            }
            offset += 1
            utf16.formIndex(after: &index)
        }

        return nil
    }

    private static func lineEndOffset(in utf16: String.UTF16View, from startOffset: Int) -> Int {
        var offset = startOffset
        var index = utf16.index(utf16.startIndex, offsetBy: startOffset)
        while index < utf16.endIndex {
            guard utf16[index] != UTF16Character.lineFeed else {
                return offset
            }
            offset += 1
            utf16.formIndex(after: &index)
        }
        return utf16.count
    }

    private static func fenceLine(in text: String, startOffset: Int, endOffset: Int) -> MarkdownFenceLine? {
        guard let markerStart = fenceMarkerStart(in: text, startOffset: startOffset, endOffset: endOffset) else {
            return nil
        }

        var index = markerStart
        let marker = text[index]
        guard marker == "`" || marker == "~" else {
            return nil
        }

        let endIndex = String.Index(utf16Offset: endOffset, in: text)
        let markerLength = consumeFenceMarker(marker, in: text, endIndex: endIndex, index: &index)
        guard markerLength >= 3 else {
            return nil
        }

        let info = String(text[index..<endIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard info.isEmpty || marker == "~" || !info.contains("`") else {
            return nil
        }

        return .init(
            marker: marker,
            markerLength: markerLength,
            info: info.isEmpty ? nil : info
        )
    }

    private static func fenceMarkerStart(in text: String, startOffset: Int, endOffset: Int) -> String.Index? {
        var index = String.Index(utf16Offset: startOffset, in: text)
        let endIndex = String.Index(utf16Offset: endOffset, in: text)
        var indentation = 0
        while index < endIndex, text[index] == " ", indentation < 4 {
            indentation += 1
            text.formIndex(after: &index)
        }
        return indentation <= 3 && index < endIndex ? index : nil
    }

    private static func consumeFenceMarker(
        _ marker: Character,
        in text: String,
        endIndex: String.Index,
        index: inout String.Index
    ) -> Int {
        var markerLength = 0
        while index < endIndex, text[index] == marker {
            markerLength += 1
            text.formIndex(after: &index)
        }
        return markerLength
    }
}

/// A parsed opening fence line and the UTF-16 offsets needed to read its body.
struct MarkdownFence {
    let startOffset: Int
    let bodyStartOffset: Int
    let marker: Character
    let markerLength: Int
    let language: String?
}

/// A parsed closing fence and the UTF-16 body range that precedes it.
struct ClosedMarkdownFence {
    let bodyRange: Range<Int>
    let endOffset: Int
}

private struct MarkdownScannedFenceLine {
    let startOffset: Int
    let endIncludingLineFeedOffset: Int
    let fence: MarkdownFenceLine
}

private struct MarkdownFenceLine {
    let marker: Character
    let markerLength: Int
    let info: String?
}
