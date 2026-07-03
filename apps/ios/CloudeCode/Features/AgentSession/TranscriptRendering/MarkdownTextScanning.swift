import Foundation

enum MarkdownTextPartFactory {
    static func richTextPart(id: Int, source: String) -> MarkdownTextPart {
        .richText(.init(
            id: id,
            source: source,
            attributedText: markdownAttributedString(from: source)
        ))
    }

    private static func markdownAttributedString(from source: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .full,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        return (try? AttributedString(markdown: source, options: options)) ?? AttributedString(source)
    }
}

enum MarkdownActivePartBuilder {
    static func parts(
        in text: String,
        from startOffset: Int,
        startingPartID: Int
    ) -> [MarkdownTextPart] {
        let totalUTF16Count = text.utf16.count
        guard startOffset < totalUTF16Count else {
            return []
        }

        var builder = Builder(text: text, totalUTF16Count: totalUTF16Count, partID: startingPartID)
        return builder.parts(from: startOffset)
    }
}

private extension MarkdownActivePartBuilder {
    struct Builder {
        let text: String
        let totalUTF16Count: Int
        var partID: Int
        var parts: [MarkdownTextPart] = []

        mutating func parts(from startOffset: Int) -> [MarkdownTextPart] {
            var cursor = startOffset
            while cursor < totalUTF16Count {
                guard let openingFence = MarkdownFenceScanner.openingFence(in: text, from: cursor) else {
                    appendRichText(cursor..<totalUTF16Count)
                    return parts
                }

                appendTextBeforeFence(openingFence, cursor: cursor)
                guard let closedFence = MarkdownFenceScanner.closedFence(opening: openingFence, in: text) else {
                    appendCodeBlock(openingFence.bodyStartOffset..<totalUTF16Count, openingFence, isComplete: false)
                    return parts
                }

                appendCodeBlock(closedFence.bodyRange, openingFence, isComplete: true)
                cursor = closedFence.endOffset
            }
            return parts
        }

        private mutating func appendTextBeforeFence(_ openingFence: MarkdownFence, cursor: Int) {
            guard openingFence.startOffset > cursor else {
                return
            }
            appendRichText(cursor..<openingFence.startOffset)
        }

        private mutating func appendRichText(_ range: Range<Int>) {
            let source = text.substring(utf16Offsets: range)
            guard !source.isEmpty else {
                return
            }
            parts.append(MarkdownTextPartFactory.richTextPart(id: partID, source: source))
            partID += 1
        }

        private mutating func appendCodeBlock(
            _ range: Range<Int>,
            _ openingFence: MarkdownFence,
            isComplete: Bool
        ) {
            parts.append(.codeBlock(.init(
                id: partID,
                text: text.substring(utf16Offsets: range),
                language: openingFence.language,
                isComplete: isComplete
            )))
            partID += 1
        }
    }
}

enum MarkdownFenceScanner {
    static func openingFence(in text: String, from startOffset: Int) -> MarkdownFence? {
        for line in lines(in: text, from: startOffset) {
            guard let fence = fenceLine(in: line.content) else {
                continue
            }

            return .init(
                startOffset: line.startOffset,
                bodyStartOffset: line.endIncludingLineFeedOffset,
                marker: fence.marker,
                markerLength: fence.markerLength,
                language: fence.info
            )
        }
        return nil
    }

    static func closedFence(opening: MarkdownFence, in text: String) -> ClosedMarkdownFence? {
        for line in lines(in: text, from: opening.bodyStartOffset) {
            guard let fence = fenceLine(in: line.content),
                  fence.marker == opening.marker,
                  fence.markerLength >= opening.markerLength,
                  fence.info == nil else {
                continue
            }

            return .init(
                bodyRange: opening.bodyStartOffset..<max(
                    opening.bodyStartOffset,
                    strippingTrailingLineFeed(before: line.startOffset, in: text)
                ),
                endOffset: line.endIncludingLineFeedOffset
            )
        }
        return nil
    }

    private static func strippingTrailingLineFeed(before offset: Int, in text: String) -> Int {
        guard offset > 0 else {
            return offset
        }

        let utf16 = text.utf16
        let previousIndex = utf16.index(utf16.startIndex, offsetBy: offset - 1)
        return utf16[previousIndex] == UTF16Character.lineFeed ? offset - 1 : offset
    }

    private static func lines(in text: String, from startOffset: Int) -> [MarkdownLine] {
        let totalUTF16Count = text.utf16.count
        guard startOffset < totalUTF16Count else {
            return []
        }

        var lines: [MarkdownLine] = []
        var lineStart = startOffset
        let utf16 = text.utf16
        var offset = startOffset
        var index = utf16.index(utf16.startIndex, offsetBy: startOffset)

        while index < utf16.endIndex {
            if utf16[index] == UTF16Character.lineFeed {
                lines.append(line(in: text, startOffset: lineStart, endOffset: offset))
                lineStart = offset + 1
            }

            offset += 1
            utf16.formIndex(after: &index)
        }

        if lineStart <= totalUTF16Count {
            lines.append(line(in: text, startOffset: lineStart, endOffset: totalUTF16Count))
        }

        return lines
    }

    private static func line(in text: String, startOffset: Int, endOffset: Int) -> MarkdownLine {
        .init(
            startOffset: startOffset,
            endOffset: endOffset,
            endIncludingLineFeedOffset: min(endOffset + 1, text.utf16.count),
            content: text.substring(utf16Offsets: startOffset..<endOffset)
        )
    }

    private static func fenceLine(in line: String) -> MarkdownFenceLine? {
        guard let markerStart = fenceMarkerStart(in: line) else {
            return nil
        }

        var index = markerStart
        let marker = line[index]
        guard marker == "`" || marker == "~" else {
            return nil
        }

        let markerLength = consumeFenceMarker(marker, in: line, index: &index)
        guard markerLength >= 3 else {
            return nil
        }

        let info = String(line[index...]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard info.isEmpty || marker == "~" || !info.contains("`") else {
            return nil
        }

        return .init(
            marker: marker,
            markerLength: markerLength,
            info: info.isEmpty ? nil : info
        )
    }

    private static func fenceMarkerStart(in line: String) -> String.Index? {
        var index = line.startIndex
        var indentation = 0
        while index < line.endIndex, line[index] == " ", indentation < 4 {
            indentation += 1
            line.formIndex(after: &index)
        }
        return indentation <= 3 && index < line.endIndex ? index : nil
    }

    private static func consumeFenceMarker(
        _ marker: Character,
        in line: String,
        index: inout String.Index
    ) -> Int {
        var markerLength = 0
        while index < line.endIndex, line[index] == marker {
            markerLength += 1
            line.formIndex(after: &index)
        }
        return markerLength
    }
}

enum MarkdownInlineState {
    static func hasUnsafeOpenConstruct(in source: String) -> Bool {
        hasTrailingEscape(in: source)
            || hasUnsafeInlineDelimiterState(in: source)
            || hasUnclosedMarkdownLink(in: source)
            || hasUnclosedAutolink(in: source)
    }

    private static func hasTrailingEscape(in source: String) -> Bool {
        let source = source.trimmingCharacters(in: .whitespacesAndNewlines)
        var count = 0
        var index = source.endIndex
        while index > source.startIndex {
            source.formIndex(before: &index)
            guard source[index] == "\\" else {
                break
            }
            count += 1
        }
        return count % 2 == 1
    }

    private static func hasUnsafeInlineDelimiterState(in source: String) -> Bool {
        var state = InlineDelimiterState()
        var index = source.startIndex
        var escapedNextCharacter = false

        while index < source.endIndex {
            if escapedNextCharacter {
                escapedNextCharacter = false
                source.formIndex(after: &index)
                continue
            }

            let character = source[index]
            if character == "\\" {
                escapedNextCharacter = true
                source.formIndex(after: &index)
                continue
            }

            if character == "`" {
                let runLength = delimiterRunLength(startingAt: index, marker: character, in: source)
                state.backtickCount += runLength
                source.formIndex(&index, offsetBy: runLength)
                continue
            }

            if character == "*" || character == "_" {
                let runLength = delimiterRunLength(startingAt: index, marker: character, in: source)
                let previous = index > source.startIndex ? source[source.index(before: index)] : nil
                let nextIndex = source.index(index, offsetBy: runLength, limitedBy: source.endIndex)
                    ?? source.endIndex
                let next = nextIndex < source.endIndex ? source[nextIndex] : nil
                state.processEmphasisRun(
                    marker: character,
                    length: runLength,
                    previous: previous,
                    next: next
                )
                index = nextIndex
                continue
            }

            source.formIndex(after: &index)
        }

        return state.hasUnsafeOpenDelimiter
    }

    private static func delimiterRunLength(
        startingAt startIndex: String.Index,
        marker: Character,
        in source: String
    ) -> Int {
        var length = 0
        var index = startIndex
        while index < source.endIndex, source[index] == marker {
            length += 1
            source.formIndex(after: &index)
        }
        return length
    }

    private static func hasUnclosedMarkdownLink(in source: String) -> Bool {
        let openBracket = source.lastIndex(of: "[")
        let closeBracket = source.lastIndex(of: "]")
        if let openBracket, closeBracket.map({ $0 < openBracket }) ?? true {
            return true
        }

        guard let closeBracket,
              source.index(after: closeBracket) < source.endIndex,
              source[source.index(after: closeBracket)] == "(" else {
            return false
        }

        let linkStart = source.index(after: closeBracket)
        return source[linkStart...].lastIndex(of: ")") == nil
    }

    private static func hasUnclosedAutolink(in source: String) -> Bool {
        guard let open = source.lastIndex(of: "<"),
              source[open...].contains("://") else {
            return false
        }
        return source[open...].lastIndex(of: ">") == nil
    }
}

private struct InlineDelimiterState {
    var backtickCount = 0
    private var openSingleStarCount = 0
    private var openStrongStarCount = 0
    private var openSingleUnderscoreCount = 0
    private var openStrongUnderscoreCount = 0

    var hasUnsafeOpenDelimiter: Bool {
        backtickCount % 2 == 1
            || openSingleStarCount > 0
            || openStrongStarCount > 0
            || openSingleUnderscoreCount > 0
            || openStrongUnderscoreCount > 0
    }

    mutating func processEmphasisRun(
        marker: Character,
        length: Int,
        previous: Character?,
        next: Character?
    ) {
        let flanking = EmphasisFlanking(previous: previous, next: next)
        let canOpen: Bool
        let canClose: Bool
        if marker == "_" {
            canOpen = flanking.isLeftFlanking && (!flanking.isRightFlanking || isPunctuation(previous))
            canClose = flanking.isRightFlanking && (!flanking.isLeftFlanking || isPunctuation(next))
        } else {
            canOpen = flanking.isLeftFlanking
            canClose = flanking.isRightFlanking
        }

        guard canOpen || canClose else {
            return
        }

        if marker == "_" {
            Self.processEmphasisUnits(
                length: length,
                canOpen: canOpen,
                canClose: canClose,
                singleOpenCount: &openSingleUnderscoreCount,
                strongOpenCount: &openStrongUnderscoreCount
            )
        } else {
            Self.processEmphasisUnits(
                length: length,
                canOpen: canOpen,
                canClose: canClose,
                singleOpenCount: &openSingleStarCount,
                strongOpenCount: &openStrongStarCount
            )
        }
    }

    private static func processEmphasisUnits(
        length: Int,
        canOpen: Bool,
        canClose: Bool,
        singleOpenCount: inout Int,
        strongOpenCount: inout Int
    ) {
        var strongUnits = length / 2
        var singleUnits = length % 2

        if canClose {
            let closingStrongUnits = min(strongOpenCount, strongUnits)
            strongOpenCount -= closingStrongUnits
            strongUnits -= closingStrongUnits

            let closingSingleUnits = min(singleOpenCount, singleUnits)
            singleOpenCount -= closingSingleUnits
            singleUnits -= closingSingleUnits
        }

        if canOpen {
            strongOpenCount += strongUnits
            singleOpenCount += singleUnits
        }
    }
}

private struct EmphasisFlanking {
    let isLeftFlanking: Bool
    let isRightFlanking: Bool

    init(previous: Character?, next: Character?) {
        isLeftFlanking = if let next {
            !isWhitespace(next) && !(isPunctuation(next) && !isWhitespace(previous) && !isPunctuation(previous))
        } else {
            false
        }
        isRightFlanking = if let previous {
            !isWhitespace(previous) && !(isPunctuation(previous) && !isWhitespace(next) && !isPunctuation(next))
        } else {
            false
        }
    }
}

private func isWhitespace(_ character: Character?) -> Bool {
    guard let character else {
        return true
    }
    return character.unicodeScalars.allSatisfy { CharacterSet.whitespacesAndNewlines.contains($0) }
}

private func isPunctuation(_ character: Character?) -> Bool {
    guard let character else {
        return false
    }
    return character.unicodeScalars.allSatisfy { CharacterSet.punctuationCharacters.contains($0) }
}

struct MarkdownFence {
    let startOffset: Int
    let bodyStartOffset: Int
    let marker: Character
    let markerLength: Int
    let language: String?
}

struct ClosedMarkdownFence {
    let bodyRange: Range<Int>
    let endOffset: Int
}

private struct MarkdownLine {
    let startOffset: Int
    let endOffset: Int
    let endIncludingLineFeedOffset: Int
    let content: String
}

private struct MarkdownFenceLine {
    let marker: Character
    let markerLength: Int
    let info: String?
}

enum UTF16Character {
    static let horizontalTab: UInt16 = 9
    static let lineFeed: UInt16 = 10
    static let space: UInt16 = 32

    static func isHorizontalWhitespace(_ value: UInt16) -> Bool {
        value == space || value == horizontalTab
    }
}

extension String {
    func substring(utf16Offsets offsets: Range<Int>) -> String {
        let start = String.Index(utf16Offset: offsets.lowerBound, in: self)
        let end = String.Index(utf16Offset: offsets.upperBound, in: self)
        return String(self[start..<end])
    }
}
