import Foundation

/// Builds renderable markdown transcript parts from source slices.
enum MarkdownTextPartFactory {
    /// Creates a rich text part by parsing inline markdown while preserving source line breaks.
    static func richTextPart(id: Int, source: String) -> MarkdownTextPart {
        .richText(.init(
            id: id,
            source: source,
            attributedText: markdownAttributedString(from: source)
        ))
    }

    private static func markdownAttributedString(from source: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        return (try? AttributedString(markdown: source, options: options)) ?? AttributedString(source)
    }
}

/// Builds the current, non-finalized markdown parts from an active transcript tail.
enum MarkdownActivePartBuilder {
    /// Returns render parts for the active source range, preserving code fence structure.
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
            while let segment = MarkdownTextSegmenter.nextSegment(in: text, from: cursor) {
                switch segment {
                case .richText(let segment):
                    appendRichText(segment.range)
                case .codeBlock(let segment):
                    appendCodeBlock(segment)
                }
                cursor = segment.endOffset
            }
            return parts
        }

        private mutating func appendRichText(_ range: Range<Int>) {
            let source = text.substring(utf16Offsets: range)
            guard !source.isEmpty else {
                return
            }
            parts.append(MarkdownTextPartFactory.richTextPart(id: partID, source: source))
            partID += 1
        }

        private mutating func appendCodeBlock(_ segment: MarkdownCodeBlockSegment) {
            parts.append(.codeBlock(.init(
                id: partID,
                text: text.substring(utf16Offsets: segment.bodyRange),
                language: segment.language,
                isComplete: segment.isComplete
            )))
            partID += 1
        }
    }
}

/// Splits transcript markdown into rich text and fenced-code segments without deciding cache finality.
enum MarkdownTextSegmenter {
    /// Returns the next source segment at or after `startOffset`.
    static func nextSegment(in text: String, from startOffset: Int) -> MarkdownTextSegment? {
        let totalUTF16Count = text.utf16.count
        guard startOffset < totalUTF16Count else {
            return nil
        }

        guard let openingFence = MarkdownFenceScanner.openingFence(in: text, from: startOffset) else {
            return .richText(.init(range: startOffset..<totalUTF16Count))
        }

        if openingFence.startOffset > startOffset {
            return .richText(.init(range: startOffset..<openingFence.startOffset))
        }

        guard let closedFence = MarkdownFenceScanner.closedFence(opening: openingFence, in: text) else {
            return .codeBlock(.init(
                bodyRange: openingFence.bodyStartOffset..<totalUTF16Count,
                language: openingFence.language,
                isComplete: false,
                endOffset: totalUTF16Count
            ))
        }

        return .codeBlock(.init(
            bodyRange: closedFence.bodyRange,
            language: openingFence.language,
            isComplete: true,
            endOffset: closedFence.endOffset
        ))
    }
}

/// A markdown source segment that can be rendered as one transcript part.
enum MarkdownTextSegment {
    case richText(MarkdownRichTextSegment)
    case codeBlock(MarkdownCodeBlockSegment)

    var endOffset: Int {
        switch self {
        case .richText(let segment):
            segment.range.upperBound
        case .codeBlock(let segment):
            segment.endOffset
        }
    }
}

/// A rich text source range outside fenced code blocks.
struct MarkdownRichTextSegment {
    let range: Range<Int>
}

/// A fenced code block source range and its parsed fence metadata.
struct MarkdownCodeBlockSegment {
    let bodyRange: Range<Int>
    let language: String?
    let isComplete: Bool
    let endOffset: Int
}

/// Tracks inline markdown constructs that are unsafe to freeze in the active paragraph.
enum MarkdownInlineState {
    /// Returns whether the current paragraph contains an unclosed inline construct.
    static func hasUnsafeOpenConstruct(in source: String) -> Bool {
        let source = currentParagraph(in: source)
        return hasTrailingEscape(in: source)
            || hasUnsafeInlineDelimiterState(in: source)
            || hasUnclosedMarkdownLink(in: source)
            || hasUnclosedAutolink(in: source)
    }

    private static func currentParagraph(in source: String) -> String {
        let utf16 = source.utf16
        var previousWasLineFeed = false
        var lastBlankLineEndOffset = 0
        var offset = 0
        var index = utf16.startIndex

        while index < utf16.endIndex {
            let value = utf16[index]
            if value == UTF16Character.lineFeed {
                if previousWasLineFeed {
                    lastBlankLineEndOffset = offset + 1
                }
                previousWasLineFeed = true
            } else if !UTF16Character.isHorizontalWhitespace(value) {
                previousWasLineFeed = false
            }

            offset += 1
            utf16.formIndex(after: &index)
        }

        guard lastBlankLineEndOffset > 0 else {
            return source
        }
        return source.substring(utf16Offsets: lastBlankLineEndOffset..<utf16.count)
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
            advanceInlineDelimiterState(
                in: source,
                index: &index,
                state: &state,
                escapedNextCharacter: &escapedNextCharacter
            )
        }

        return state.hasUnsafeOpenDelimiter
    }

    private static func advanceInlineDelimiterState(
        in source: String,
        index: inout String.Index,
        state: inout InlineDelimiterState,
        escapedNextCharacter: inout Bool
    ) {
        if escapedNextCharacter {
            escapedNextCharacter = false
            source.formIndex(after: &index)
            return
        }

        let character = source[index]
        if character == "`" {
            processBacktickRun(in: source, index: &index, state: &state)
        } else if state.isInsideCodeSpan {
            source.formIndex(after: &index)
        } else if character == "\\" {
            escapedNextCharacter = true
            source.formIndex(after: &index)
        } else if character == "*" || character == "_" {
            processEmphasisRun(in: source, index: &index, state: &state)
        } else {
            source.formIndex(after: &index)
        }
    }

    private static func processBacktickRun(
        in source: String,
        index: inout String.Index,
        state: inout InlineDelimiterState
    ) {
        let runLength = delimiterRunLength(startingAt: index, marker: source[index], in: source)
        state.processBacktickRun(length: runLength)
        source.formIndex(&index, offsetBy: runLength)
    }

    private static func processEmphasisRun(
        in source: String,
        index: inout String.Index,
        state: inout InlineDelimiterState
    ) {
        let marker = source[index]
        let runLength = delimiterRunLength(startingAt: index, marker: marker, in: source)
        let previous = index > source.startIndex ? source[source.index(before: index)] : nil
        let nextIndex = source.index(index, offsetBy: runLength, limitedBy: source.endIndex) ?? source.endIndex
        let next = nextIndex < source.endIndex ? source[nextIndex] : nil
        state.processEmphasisRun(marker: marker, length: runLength, previous: previous, next: next)
        index = nextIndex
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
    private var openCodeSpanDelimiterLength: Int?
    private var openSingleStarCount = 0
    private var openStrongStarCount = 0
    private var openSingleUnderscoreCount = 0
    private var openStrongUnderscoreCount = 0

    var isInsideCodeSpan: Bool {
        openCodeSpanDelimiterLength != nil
    }

    var hasUnsafeOpenDelimiter: Bool {
        openCodeSpanDelimiterLength != nil
            || openSingleStarCount > 0
            || openStrongStarCount > 0
            || openSingleUnderscoreCount > 0
            || openStrongUnderscoreCount > 0
    }

    mutating func processBacktickRun(length: Int) {
        if openCodeSpanDelimiterLength == length {
            openCodeSpanDelimiterLength = nil
        } else if openCodeSpanDelimiterLength == nil {
            openCodeSpanDelimiterLength = length
        }
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

/// UTF-16 code units used by transcript markdown scanners.
enum UTF16Character {
    static let horizontalTab: UInt16 = 9
    static let lineFeed: UInt16 = 10
    static let space: UInt16 = 32

    /// Returns whether a code unit is horizontal whitespace.
    static func isHorizontalWhitespace(_ value: UInt16) -> Bool {
        value == space || value == horizontalTab
    }
}

extension String {
    /// Returns a substring addressed by UTF-16 offsets in this string.
    func substring(utf16Offsets offsets: Range<Int>) -> String {
        let start = String.Index(utf16Offset: offsets.lowerBound, in: self)
        let end = String.Index(utf16Offset: offsets.upperBound, in: self)
        return String(self[start..<end])
    }
}
