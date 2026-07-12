import Foundation

/// Incrementally converts an append-only Markdown source into stable render parts.
public struct IncrementalMarkdownDocument: Sendable {
    /// Chunking limits for incremental prose rendering.
    public struct Configuration: Sendable, Hashable {
        /// Maximum consecutive paragraphs in one prose part.
        public var maximumParagraphsPerPart: Int = 5

        /// Hard maximum UTF-16 length for an unusually long prose fragment.
        public var maximumProseUTF16Length: Int = 2_400

        /// Maximum distance searched backward for a safe whitespace split.
        public var softBoundaryLookbackUTF16Length: Int = 600

        /// Preferred minimum UTF-16 length before a soft split.
        public var minimumSoftBoundaryUTF16Length: Int = 800

        /// Creates the default Markdown chunking configuration.
        public init() {}
    }

    private var previousSource = ""
    private var finalizedParts: [MarkdownPart] = []
    private var activeStartUTF16Offset = 0
    private var tailStartsMidLine = false
    private var knownCodeRanges: [Range<Int>] = []
    private var mode: MarkdownRenderSnapshot.Mode = .incrementalTail
    private var cachedSnapshot: MarkdownRenderSnapshot?
    private let configuration: Configuration

    /// Creates an incremental Markdown document with configurable prose limits.
    ///
    /// - Parameter configuration: Paragraph batching and hard-cap limits.
    public init(configuration: Configuration = .init()) {
        var configuration = configuration
        configuration.maximumParagraphsPerPart = max(1, configuration.maximumParagraphsPerPart)
        configuration.maximumProseUTF16Length = max(1, configuration.maximumProseUTF16Length)
        configuration.softBoundaryLookbackUTF16Length = max(0, configuration.softBoundaryLookbackUTF16Length)
        configuration.minimumSoftBoundaryUTF16Length = max(0, configuration.minimumSoftBoundaryUTF16Length)
        self.configuration = configuration
    }

    /// Updates the append-only document and returns its current render snapshot.
    ///
    /// - Parameters:
    ///   - source: The complete current Markdown source.
    ///   - isStreaming: Whether more source may still be appended.
    /// - Returns: Stable finalized parts followed by the reparsed active tail.
    public mutating func update(source: String, isStreaming: Bool) -> MarkdownRenderSnapshot {
        if source == previousSource, let cachedSnapshot {
            if !isStreaming, cachedSnapshot.parts.contains(where: { $0.stability == .active }) {
                // Completion changes stability even when the final source is unchanged.
            } else {
                return cachedSnapshot
            }
        }

        if !source.hasPrefix(previousSource) {
            reset()
        }
        previousSource = source

        if mode == .wholeDocument {
            return parseWholeDocument(source: source, isStreaming: isStreaming)
        }

        let parsedTail = parseActiveTail(source: source)
        knownCodeRanges = knownCodeRanges.filter { $0.upperBound <= activeStartUTF16Offset }
            + parsedTail.codeRanges
        if ReferenceDefinitionDetector.detectsDefinition(
            in: source,
            excluding: knownCodeRanges
        ) {
            finalizedParts.removeAll()
            activeStartUTF16Offset = 0
            tailStartsMidLine = false
            mode = .wholeDocument
            return parseWholeDocument(source: source, isStreaming: isStreaming)
        }

        let stableCount = unstableSuffixCount(
            blocks: parsedTail.blocks,
            source: source,
            isStreaming: isStreaming
        ).map { parsedTail.blocks.count - $0 } ?? parsedTail.blocks.count
        var candidates = buildCandidates(from: parsedTail.blocks)
        markFinalizedCandidates(&candidates, stableBlockCount: stableCount, isStreaming: isStreaming)

        let capped = capLeadingActiveProse(candidates: candidates, source: source)
        finalizedParts.append(contentsOf: capped.finalized)
        candidates = capped.remaining

        let newlyFinalized = candidates.prefix { $0.isFinalized }.map(\.part)
        finalizedParts.append(contentsOf: newlyFinalized)
        let activeCandidates = candidates.dropFirst(newlyFinalized.count)

        if let firstActive = activeCandidates.first {
            activeStartUTF16Offset = firstActive.range.lowerBound
            tailStartsMidLine = !source.isPhysicalLineStart(utf16Offset: activeStartUTF16Offset)
        } else {
            activeStartUTF16Offset = source.utf16.count
            tailStartsMidLine = false
        }

        let snapshot = MarkdownRenderSnapshot(
            parts: finalizedParts + activeCandidates.map(\.part),
            mode: .incrementalTail
        )
        cachedSnapshot = snapshot
        return snapshot
    }

    /// Clears all cached source, finalized parts, and parsing mode state.
    public mutating func reset() {
        previousSource = ""
        finalizedParts = []
        activeStartUTF16Offset = 0
        tailStartsMidLine = false
        knownCodeRanges = []
        mode = .incrementalTail
        cachedSnapshot = nil
    }

    private func parseActiveTail(source: String) -> ParsedMarkdown {
        guard tailStartsMidLine else {
            let tail = source.substring(utf16Offsets: activeStartUTF16Offset..<source.utf16.count)
            return parseMarkdown(source: tail, absoluteUTF16Offset: activeStartUTF16Offset)
        }

        let lineStart = source.physicalLineStart(beforeUTF16Offset: activeStartUTF16Offset)
        let contextualSource = source.substring(utf16Offsets: lineStart..<source.utf16.count)
        let contextual = parseMarkdown(source: contextualSource, absoluteUTF16Offset: lineStart)
        var blocks = contextual.blocks.filter { $0.absoluteSourceRange.upperBound > activeStartUTF16Offset }

        if let first = blocks.first, case .paragraph = first.kind,
           first.absoluteSourceRange.lowerBound < activeStartUTF16Offset {
            let range = activeStartUTF16Offset..<first.absoluteSourceRange.upperBound
            let rawSource = source.substring(utf16Offsets: range)
            let paragraph = MarkdownParagraph(
                id: .init(utf16SourceOffset: activeStartUTF16Offset),
                content: inlineMarkdownAttributedString(from: rawSource.trimmingOneTrailingLineFeed())
            )
            blocks[0] = .init(
                absoluteSourceRange: range,
                syntaxSourceRange: range,
                startLine: first.startLine,
                endLine: first.endLine,
                kind: .paragraph(paragraph),
                block: .init(id: paragraph.id, content: .prose(paragraphs: [paragraph]))
            )
        }

        return ParsedMarkdown(
            blocks: blocks,
            codeRanges: contextual.codeRanges.filter { $0.upperBound > activeStartUTF16Offset }
        )
    }

    private mutating func parseWholeDocument(source: String, isStreaming: Bool) -> MarkdownRenderSnapshot {
        let parsed = parseMarkdown(source: source, absoluteUTF16Offset: 0)
        var candidates = buildCandidates(from: parsed.blocks)
        if candidates.isEmpty, !source.isEmpty {
            let id = MarkdownSourceID(utf16SourceOffset: 0)
            candidates = [Candidate(
                range: 0..<source.utf16.count,
                blockIndices: [],
                part: MarkdownPart(
                    id: id,
                    source: source,
                    block: MarkdownBlock(id: id, content: .sourceOnly),
                    stability: isStreaming ? .active : .finalized
                ),
                isFinalized: !isStreaming,
                isProse: false
            )]
        } else {
            for index in candidates.indices {
                candidates[index].isFinalized = !isStreaming
                candidates[index].part = candidates[index].part.withStability(isStreaming ? .active : .finalized)
            }
            candidates = splitOversizedProseCandidates(candidates, source: source)
        }
        let snapshot = MarkdownRenderSnapshot(parts: candidates.map(\.part), mode: .wholeDocument)
        cachedSnapshot = snapshot
        return snapshot
    }

    private func unstableSuffixCount(
        blocks: [ParsedMarkdown.TopLevelBlock],
        source: String,
        isStreaming: Bool
    ) -> Int? {
        guard isStreaming, !blocks.isEmpty else {
            return nil
        }
        guard blocks.count >= 2 else {
            return 1
        }
        let predecessor = blocks[blocks.count - 2]
        let trailing = blocks[blocks.count - 1]
        let interveningStart = min(predecessor.syntaxSourceRange.upperBound, trailing.syntaxSourceRange.lowerBound)
        let intervening = source.substring(
            utf16Offsets: interveningStart..<trailing.syntaxSourceRange.lowerBound
        )
        let hasBlankLine = intervening
            .split(separator: "\n", omittingEmptySubsequences: false)
            .dropFirst()
            .dropLast()
            .contains { $0.allSatisfy { $0 == " " || $0 == "\t" || $0 == "\r" } }
        return hasBlankLine ? 1 : 2
    }

    private func buildCandidates(from blocks: [ParsedMarkdown.TopLevelBlock]) -> [Candidate] {
        var candidates: [Candidate] = []
        var pendingParagraphs: [(Int, ParsedMarkdown.TopLevelBlock, MarkdownParagraph)] = []

        func proseCandidate(
            _ paragraphs: [(Int, ParsedMarkdown.TopLevelBlock, MarkdownParagraph)]
        ) -> Candidate? {
            guard let first = paragraphs.first, let last = paragraphs.last else {
                return nil
            }
            let range = first.1.absoluteSourceRange.lowerBound..<last.1.absoluteSourceRange.upperBound
            let id = first.2.id
            return Candidate(
                range: range,
                blockIndices: paragraphs.map(\.0),
                part: MarkdownPart(
                    id: id,
                    source: previousSource.substring(utf16Offsets: range),
                    block: MarkdownBlock(id: id, content: .prose(paragraphs: paragraphs.map(\.2))),
                    stability: .active,
                    leadingBoundary: previousSource.isPhysicalLineStart(utf16Offset: range.lowerBound)
                        ? .block
                        : .proseContinuation
                ),
                isFinalized: false,
                isProse: true
            )
        }

        for (index, block) in blocks.enumerated() {
            switch block.kind {
            case .paragraph(let paragraph):
                pendingParagraphs.append((index, block, paragraph))
                if pendingParagraphs.count == configuration.maximumParagraphsPerPart {
                    if let candidate = proseCandidate(pendingParagraphs) {
                        candidates.append(candidate)
                    }
                    pendingParagraphs.removeAll()
                }
            case .semantic:
                if let candidate = proseCandidate(pendingParagraphs) {
                    candidates.append(candidate)
                }
                pendingParagraphs.removeAll()
                let source = previousSource.substring(utf16Offsets: block.absoluteSourceRange)
                candidates.append(Candidate(
                    range: block.absoluteSourceRange,
                    blockIndices: [index],
                    part: MarkdownPart(
                        id: block.block.id,
                        source: source,
                        block: block.block,
                        stability: .active
                    ),
                    isFinalized: false,
                    isProse: false
                ))
            }
        }
        if let candidate = proseCandidate(pendingParagraphs) {
            candidates.append(candidate)
        }
        return candidates
    }

    private func markFinalizedCandidates(
        _ candidates: inout [Candidate],
        stableBlockCount: Int,
        isStreaming: Bool
    ) {
        for index in candidates.indices {
            let candidate = candidates[index]
            let structurallyStable = candidate.blockIndices.allSatisfy { $0 < stableBlockCount }
            let nextIsSemantic = index + 1 < candidates.count && !candidates[index + 1].isProse
            let paragraphBatchIsFull = candidate.blockIndices.count >= configuration.maximumParagraphsPerPart
            let shouldFinalize = !isStreaming || (structurallyStable && (
                !candidate.isProse || paragraphBatchIsFull || nextIsSemantic
            ))
            candidates[index].isFinalized = shouldFinalize
            candidates[index].part = candidate.part.withStability(shouldFinalize ? .finalized : .active)
        }
    }

    private func capLeadingActiveProse(
        candidates: [Candidate],
        source: String
    ) -> (finalized: [MarkdownPart], remaining: [Candidate]) {
        guard let firstActiveIndex = candidates.firstIndex(where: { !$0.isFinalized }),
              candidates[firstActiveIndex].isProse else {
            return ([], candidates)
        }
        var candidate = candidates[firstActiveIndex]
        var finalized: [MarkdownPart] = []

        while candidate.range.count > configuration.maximumProseUTF16Length {
            guard let boundary = hardBoundary(in: source, range: candidate.range),
                  boundary > candidate.range.lowerBound else {
                break
            }
            let range = candidate.range.lowerBound..<boundary
            let partSource = source.substring(utf16Offsets: range)
            let id = MarkdownSourceID(utf16SourceOffset: range.lowerBound)
            let paragraph = MarkdownParagraph(
                id: id,
                content: inlineMarkdownAttributedString(from: partSource.trimmingOneTrailingLineFeed())
            )
            finalized.append(MarkdownPart(
                id: id,
                source: partSource,
                block: MarkdownBlock(id: id, content: .prose(paragraphs: [paragraph])),
                stability: .finalized,
                leadingBoundary: source.isPhysicalLineStart(utf16Offset: range.lowerBound)
                    ? .block
                    : .proseContinuation
            ))
            candidate.range = boundary..<candidate.range.upperBound
            let remainderSource = source.substring(utf16Offsets: candidate.range)
            let remainderID = MarkdownSourceID(utf16SourceOffset: boundary)
            let remainderParagraph = MarkdownParagraph(
                id: remainderID,
                content: inlineMarkdownAttributedString(from: remainderSource.trimmingOneTrailingLineFeed())
            )
            candidate.part = MarkdownPart(
                id: remainderID,
                source: remainderSource,
                block: MarkdownBlock(id: remainderID, content: .prose(paragraphs: [remainderParagraph])),
                stability: .active,
                leadingBoundary: source.isPhysicalLineStart(utf16Offset: boundary) ? .block : .proseContinuation
            )
        }

        var remaining = candidates
        remaining[firstActiveIndex] = candidate
        return (finalized, remaining)
    }

    private func splitOversizedProseCandidates(
        _ candidates: [Candidate],
        source: String
    ) -> [Candidate] {
        candidates.flatMap { original in
            guard original.isProse,
                  original.range.count > configuration.maximumProseUTF16Length else {
                return [original]
            }
            var range = original.range
            var parts: [Candidate] = []
            while range.count > configuration.maximumProseUTF16Length {
                guard let boundary = hardBoundary(in: source, range: range) else {
                    return [original]
                }
                let fragmentRange = range.lowerBound..<boundary
                parts.append(proseFragmentCandidate(
                    range: fragmentRange,
                    source: source,
                    stability: original.part.stability,
                    isFinalized: original.isFinalized
                ))
                range = boundary..<range.upperBound
            }
            if !range.isEmpty {
                parts.append(proseFragmentCandidate(
                    range: range,
                    source: source,
                    stability: original.part.stability,
                    isFinalized: original.isFinalized
                ))
            }
            return parts
        }
    }

    private func proseFragmentCandidate(
        range: Range<Int>,
        source: String,
        stability: MarkdownPart.Stability,
        isFinalized: Bool
    ) -> Candidate {
        let fragment = source.substring(utf16Offsets: range)
        let id = MarkdownSourceID(utf16SourceOffset: range.lowerBound)
        let paragraph = MarkdownParagraph(
            id: id,
            content: inlineMarkdownAttributedString(from: fragment.trimmingOneTrailingLineFeed())
        )
        return Candidate(
            range: range,
            blockIndices: [],
            part: MarkdownPart(
                id: id,
                source: fragment,
                block: MarkdownBlock(id: id, content: .prose(paragraphs: [paragraph])),
                stability: stability,
                leadingBoundary: source.isPhysicalLineStart(utf16Offset: range.lowerBound)
                    ? .block
                    : .proseContinuation
            ),
            isFinalized: isFinalized,
            isProse: true
        )
    }

    private func hardBoundary(in source: String, range: Range<Int>) -> Int? {
        let hardBoundary = min(range.lowerBound + configuration.maximumProseUTF16Length, range.upperBound)
        let cappedSource = source.substring(utf16Offsets: range.lowerBound..<hardBoundary)
        if let expression = try? NSRegularExpression(pattern: "\\n[ \\t\\r]*\\n"),
           let match = expression.matches(
            in: cappedSource,
            range: NSRange(location: 0, length: cappedSource.utf16.count)
           ).last {
            let paragraphBoundary = range.lowerBound + NSMaxRange(match.range)
            let candidate = source.substring(utf16Offsets: range.lowerBound..<paragraphBoundary)
            if InlineBoundarySafety.isSafe(candidate) {
                return paragraphBoundary
            }
        }
        let lowerBound = max(
            range.lowerBound + configuration.minimumSoftBoundaryUTF16Length,
            hardBoundary - configuration.softBoundaryLookbackUTF16Length
        )
        guard lowerBound < hardBoundary else {
            let boundary = source.validUnicodeBoundary(
                atOrBeforeUTF16Offset: hardBoundary,
                after: range.lowerBound
            )
            let candidate = source.substring(utf16Offsets: range.lowerBound..<boundary)
            return InlineBoundarySafety.isSafe(candidate) ? boundary : nil
        }

        let fragment = source.substring(utf16Offsets: lowerBound..<hardBoundary)
        var localOffset = fragment.utf16.count
        for character in fragment.reversed() {
            localOffset -= String(character).utf16.count
            if character.isWhitespace {
                let boundary = lowerBound + localOffset + String(character).utf16.count
                let validBoundary = source.validUnicodeBoundary(
                    atOrBeforeUTF16Offset: boundary,
                    after: range.lowerBound
                )
                let candidate = source.substring(utf16Offsets: range.lowerBound..<validBoundary)
                if InlineBoundarySafety.isSafe(candidate) {
                    return validBoundary
                }
            }
        }
        let suffix = source.substring(utf16Offsets: hardBoundary..<range.upperBound)
        var forwardOffset = hardBoundary
        for character in suffix {
            forwardOffset += String(character).utf16.count
            guard character.isWhitespace else {
                continue
            }
            let boundary = source.validUnicodeBoundary(
                atOrBeforeUTF16Offset: forwardOffset,
                after: range.lowerBound
            )
            let candidate = source.substring(utf16Offsets: range.lowerBound..<boundary)
            if InlineBoundarySafety.isSafe(candidate) {
                return boundary
            }
        }
        let boundary = source.validUnicodeBoundary(
            atOrBeforeUTF16Offset: hardBoundary,
            after: range.lowerBound
        )
        let candidate = source.substring(utf16Offsets: range.lowerBound..<boundary)
        return InlineBoundarySafety.isSafe(candidate) ? boundary : nil
    }
}

private enum InlineBoundarySafety {
    static func isSafe(_ source: String) -> Bool {
        let paragraph = source.components(separatedBy: "\n\n").last ?? source
        var escaped = false
        var codeDelimiterLength: Int?
        var emphasisMarkers = 0
        var bracketDepth = 0
        var angleDepth = 0
        var index = paragraph.startIndex

        while index < paragraph.endIndex {
            let character = paragraph[index]
            if escaped {
                escaped = false
                paragraph.formIndex(after: &index)
                continue
            }
            if character == "\\" {
                escaped = true
                paragraph.formIndex(after: &index)
                continue
            }
            if character == "`" {
                let run = paragraph[index...].prefix(while: { $0 == "`" }).count
                if codeDelimiterLength == run {
                    codeDelimiterLength = nil
                } else if codeDelimiterLength == nil {
                    codeDelimiterLength = run
                }
                paragraph.formIndex(&index, offsetBy: run)
                continue
            }
            if codeDelimiterLength == nil {
                switch character {
                case "*", "_": emphasisMarkers += 1
                case "[": bracketDepth += 1
                case "]": bracketDepth = max(0, bracketDepth - 1)
                case "<": angleDepth += 1
                case ">": angleDepth = max(0, angleDepth - 1)
                default: break
                }
            }
            paragraph.formIndex(after: &index)
        }

        return !escaped
            && codeDelimiterLength == nil
            && emphasisMarkers.isMultiple(of: 2)
            && bracketDepth == 0
            && angleDepth == 0
    }
}

private struct Candidate {
    var range: Range<Int>
    let blockIndices: [Int]
    var part: MarkdownPart
    var isFinalized: Bool
    let isProse: Bool
}

private enum ReferenceDefinitionDetector {
    static func detectsDefinition(in source: String, excluding codeRanges: [Range<Int>]) -> Bool {
        var offset = 0
        var openFence: (marker: Character, length: Int)?
        for line in source.split(separator: "\n", omittingEmptySubsequences: false) {
            let lineString = String(line).trimmingSuffix("\r")
            let lineRange = offset..<(offset + lineString.utf16.count)
            defer { offset += line.utf16.count + 1 }
            if let fence = fence(in: lineString) {
                if let currentFence = openFence {
                    if fence.marker == currentFence.marker, fence.length >= currentFence.length, fence.isClosing {
                        openFence = nil
                    }
                } else {
                    openFence = (fence.marker, fence.length)
                }
                continue
            }
            guard openFence == nil,
                  !lineString.hasPrefix("    "),
                  !lineString.hasPrefix("\t") else {
                continue
            }
            guard !codeRanges.contains(where: { $0.overlaps(lineRange) }) else {
                continue
            }
            var candidate = lineString[...]
            var containerCount = 0
            while containerCount < 8 {
                candidate = candidate.drop(while: { $0 == " " || $0 == "\t" })
                if candidate.hasPrefix(">") {
                    candidate = candidate.dropFirst()
                    containerCount += 1
                    continue
                }
                if let marker = candidate.first, "-*+".contains(marker), candidate.dropFirst().first?.isWhitespace == true {
                    candidate = candidate.dropFirst(2)
                    containerCount += 1
                    continue
                }
                let digits = candidate.prefix(while: \.isNumber)
                if !digits.isEmpty {
                    let suffix = candidate.dropFirst(digits.count)
                    if let marker = suffix.first, ".)".contains(marker), suffix.dropFirst().first?.isWhitespace == true {
                        candidate = suffix.dropFirst(2)
                        containerCount += 1
                        continue
                    }
                }
                break
            }
            candidate = candidate.drop(while: { $0 == " " || $0 == "\t" })
            guard candidate.hasPrefix("["), let separator = candidate.range(of: "]:"),
                  separator.lowerBound > candidate.startIndex else {
                continue
            }
            return true
        }
        return false
    }

    private static func fence(in line: String) -> (marker: Character, length: Int, isClosing: Bool)? {
        let indentation = line.prefix(while: { $0 == " " }).count
        guard indentation <= 3 else {
            return nil
        }
        let candidate = line.dropFirst(indentation)
        guard let marker = candidate.first, marker == "`" || marker == "~" else {
            return nil
        }
        let length = candidate.prefix(while: { $0 == marker }).count
        guard length >= 3 else {
            return nil
        }
        let remainder = candidate.dropFirst(length)
        let isClosing = remainder.allSatisfy { $0 == " " || $0 == "\t" }
        return (marker, length, isClosing)
    }
}

private extension MarkdownPart {
    func withStability(_ stability: Stability) -> Self {
        .init(
            id: id,
            source: source,
            block: block,
            stability: stability,
            leadingBoundary: leadingBoundary
        )
    }
}

private extension String {
    func physicalLineStart(beforeUTF16Offset offset: Int) -> Int {
        let utf16Source = self as NSString
        var current = min(max(0, offset), utf16Source.length)
        while current > 0 {
            if utf16Source.character(at: current - 1) == 0x0A {
                return current
            }
            current -= 1
        }
        return 0
    }

    func isPhysicalLineStart(utf16Offset offset: Int) -> Bool {
        offset == 0 || (self as NSString).character(at: offset - 1) == 0x0A
    }

    func validUnicodeBoundary(atOrBeforeUTF16Offset offset: Int, after lowerBound: Int) -> Int {
        var candidate = min(max(offset, lowerBound + 1), utf16.count)
        while candidate > lowerBound {
            let index = utf16.index(utf16.startIndex, offsetBy: candidate)
            if String.Index(index, within: self) != nil {
                return candidate
            }
            candidate -= 1
        }
        return min(utf16.count, lowerBound + 1)
    }

    func trimmingOneTrailingLineFeed() -> String {
        hasSuffix("\n") ? String(dropLast()) : self
    }

    func trimmingSuffix(_ suffix: String) -> String {
        hasSuffix(suffix) ? String(dropLast(suffix.count)) : self
    }
}
