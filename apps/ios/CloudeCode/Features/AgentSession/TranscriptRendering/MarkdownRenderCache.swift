import Foundation
import MarkdownParsing

/// Converts assistant text render items into incrementally cached semantic Markdown parts.
final class MarkdownRenderCache {
    private var documentsByPartKey: [String: IncrementalMarkdownDocument] = [:]
    private let configuration: IncrementalMarkdownDocument.Configuration

    var cachedDocumentCount: Int {
        documentsByPartKey.count
    }

    /// Creates a cache with configurable prose batching and length limits.
    init(
        maximumProseUTF16Length: Int = 2_400,
        softBoundaryLookbackUTF16Length: Int = 600,
        minimumSoftBoundaryUTF16Length: Int = 800,
        maximumParagraphsPerPart: Int = 5
    ) {
        var configuration = IncrementalMarkdownDocument.Configuration()
        configuration.maximumProseUTF16Length = maximumProseUTF16Length
        configuration.softBoundaryLookbackUTF16Length = softBoundaryLookbackUTF16Length
        configuration.minimumSoftBoundaryUTF16Length = minimumSoftBoundaryUTF16Length
        configuration.maximumParagraphsPerPart = maximumParagraphsPerPart
        self.configuration = configuration
    }

    /// Returns render items with assistant text converted to semantic Markdown parts.
    func renderItems(
        from items: [AgentSessionRenderItem],
        isStreaming: Bool
    ) -> [AgentSessionRenderItem] {
        items.map { item in
            guard case .text(let textItem) = item else {
                return item
            }

            var document = documentsByPartKey[textItem.key]
                ?? IncrementalMarkdownDocument(configuration: configuration)
            let snapshot = document.update(source: textItem.text, isStreaming: isStreaming)
            documentsByPartKey[textItem.key] = document

            return .markdown(.init(
                key: textItem.key,
                text: textItem.text,
                parts: snapshot.parts
            ))
        }
    }

    /// Clears all per-text-item Markdown documents.
    func reset() {
        documentsByPartKey = [:]
    }
}
