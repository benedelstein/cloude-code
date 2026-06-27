import Foundation

final class ChunkedTextRenderCache {
    private var textCachesByPartKey: [String: MarkdownTextPartCache] = [:]
    private let maxActiveTextUTF16Length: Int
    private let softBoundaryLookbackUTF16Length: Int
    private let minimumSoftBoundaryUTF16Length: Int

    init(
        maxLineBreaksPerChunk: Int = 5,
        maxChunkUTF16Length: Int = 2_400,
        softBoundaryLookbackUTF16Length: Int = 600,
        minimumSoftBoundaryUTF16Length: Int = 800
    ) {
        _ = maxLineBreaksPerChunk
        maxActiveTextUTF16Length = max(1, maxChunkUTF16Length)
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

            let cache = textCachesByPartKey[textItem.key] ?? MarkdownTextPartCache(
                maxActiveTextUTF16Length: maxActiveTextUTF16Length,
                softBoundaryLookbackUTF16Length: softBoundaryLookbackUTF16Length,
                minimumSoftBoundaryUTF16Length: minimumSoftBoundaryUTF16Length
            )
            textCachesByPartKey[textItem.key] = cache

            return .chunkedText(.init(
                key: textItem.key,
                text: textItem.text,
                parts: cache.parts(for: textItem.text)
            ))
        }
    }

    func reset() {
        textCachesByPartKey = [:]
    }
}

private final class MarkdownTextPartCache {
    private var previousText = ""
    private var activeStartUTF16Offset = 0
    private var finalizedParts: [MarkdownTextPart] = []
    private var nextPartID = 0

    private let maxActiveTextUTF16Length: Int
    private let softBoundaryLookbackUTF16Length: Int
    private let minimumSoftBoundaryUTF16Length: Int

    init(
        maxActiveTextUTF16Length: Int,
        softBoundaryLookbackUTF16Length: Int,
        minimumSoftBoundaryUTF16Length: Int
    ) {
        self.maxActiveTextUTF16Length = maxActiveTextUTF16Length
        self.softBoundaryLookbackUTF16Length = softBoundaryLookbackUTF16Length
        self.minimumSoftBoundaryUTF16Length = minimumSoftBoundaryUTF16Length
    }

    func parts(for text: String) -> [MarkdownTextPart] {
        if !text.hasPrefix(previousText) {
            reset()
        }

        previousText = text
        finalizeStableParts(in: text)
        return finalizedParts + activeParts(in: text)
    }

    private func reset() {
        previousText = ""
        activeStartUTF16Offset = 0
        finalizedParts = []
        nextPartID = 0
    }

    private func finalizeStableParts(in text: String) {
        let totalUTF16Count = text.utf16.count

        while activeStartUTF16Offset < totalUTF16Count {
            if let openingFence = MarkdownFenceScanner.openingFence(
                in: text,
                from: activeStartUTF16Offset
            ) {
                if openingFence.startOffset > activeStartUTF16Offset {
                    guard finalizeTextBeforeFence(openingFence, in: text) else {
                        return
                    }
                    continue
                }

                guard let closedFence = MarkdownFenceScanner.closedFence(
                    opening: openingFence,
                    in: text
                ) else {
                    return
                }

                appendCodeBlock(
                    text.substring(utf16Offsets: closedFence.bodyRange),
                    language: openingFence.language,
                    isComplete: true
                )
                activeStartUTF16Offset = closedFence.endOffset
                continue
            }

            guard let boundary = stableTextBoundary(in: text) else {
                return
            }

            appendRichText(text.substring(utf16Offsets: activeStartUTF16Offset..<boundary))
            activeStartUTF16Offset = boundary
        }
    }

    private func finalizeTextBeforeFence(
        _ openingFence: MarkdownFence,
        in text: String
    ) -> Bool {
        let source = text.substring(utf16Offsets: activeStartUTF16Offset..<openingFence.startOffset)
        guard !source.isEmpty else {
            activeStartUTF16Offset = openingFence.startOffset
            return true
        }
        guard !MarkdownInlineState.hasUnsafeOpenConstruct(in: source) else {
            return false
        }

        appendRichText(source)
        activeStartUTF16Offset = openingFence.startOffset
        return true
    }

    private func stableTextBoundary(in text: String) -> Int? {
        let totalUTF16Count = text.utf16.count
        guard activeStartUTF16Offset < totalUTF16Count else {
            return nil
        }

        if let blankLineBoundary = blankLineBoundary(in: text),
           canFinalizeText(in: text, boundary: blankLineBoundary) {
            return blankLineBoundary
        }

        guard totalUTF16Count - activeStartUTF16Offset > maxActiveTextUTF16Length else {
            return nil
        }

        return hardLengthBoundary(in: text)
    }

    private func blankLineBoundary(in text: String) -> Int? {
        let utf16 = text.utf16
        var previousWasLineFeed = false
        var offset = activeStartUTF16Offset
        var index = utf16.index(utf16.startIndex, offsetBy: activeStartUTF16Offset)

        while index < utf16.endIndex {
            let value = utf16[index]
            if value == UTF16Character.lineFeed {
                if previousWasLineFeed {
                    return offset + 1
                }
                previousWasLineFeed = true
            } else if !UTF16Character.isHorizontalWhitespace(value) {
                previousWasLineFeed = false
            }

            offset += 1
            utf16.formIndex(after: &index)
        }

        return nil
    }

    private func hardLengthBoundary(in text: String) -> Int? {
        let totalUTF16Count = text.utf16.count
        let hardBoundary = min(activeStartUTF16Offset + maxActiveTextUTF16Length, totalUTF16Count)
        let lowerBound = max(
            activeStartUTF16Offset + minimumSoftBoundaryUTF16Length,
            hardBoundary - softBoundaryLookbackUTF16Length
        )
        guard lowerBound < hardBoundary else {
            return canFinalizeText(in: text, boundary: hardBoundary) ? hardBoundary : nil
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

        return canFinalizeText(in: text, boundary: hardBoundary) ? hardBoundary : nil
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
