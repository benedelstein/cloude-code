import Foundation

/// A stable identity derived from a node's position in the complete Markdown source.
public struct MarkdownSourceID: Sendable, Hashable {
    /// The node's absolute UTF-16 source offset.
    public let utf16SourceOffset: Int

    /// The ordinal among siblings that begin at the same source offset.
    public let siblingOrdinal: Int

    init(utf16SourceOffset: Int, siblingOrdinal: Int = 0) {
        self.utf16SourceOffset = utf16SourceOffset
        self.siblingOrdinal = siblingOrdinal
    }
}

/// A render-ready snapshot of a Markdown document.
public struct MarkdownRenderSnapshot: Sendable, Hashable {
    /// The parsing strategy currently used by the document.
    public enum Mode: Sendable, Hashable {
        /// Only the mutable tail is reparsed.
        case incrementalTail

        /// The complete source is reparsed to resolve document-wide references.
        case wholeDocument
    }

    /// Ordered render parts whose source slices reconstruct the complete input.
    public let parts: [MarkdownPart]

    /// The parsing strategy used to build this snapshot.
    public let mode: Mode

    init(parts: [MarkdownPart], mode: Mode) {
        self.parts = parts
        self.mode = mode
    }
}

/// A top-level cache and render unit in a Markdown document.
public struct MarkdownPart: Identifiable, Sendable, Hashable {
    /// Whether a part can still change as source is appended.
    public enum Stability: Sendable, Hashable {
        /// The source and rendered value will not be rebuilt.
        case finalized

        /// More appended source may change this part.
        case active
    }

    /// How the part joins the content before it.
    public enum LeadingBoundary: Sendable, Hashable {
        /// The part begins at a Markdown block boundary.
        case block

        /// The part continues prose split within a physical source line.
        case proseContinuation
    }

    /// The source-derived stable identity.
    public let id: MarkdownSourceID

    /// The exact source slice represented by this part.
    public let source: String

    /// The semantic block rendered by the app.
    public let block: MarkdownBlock

    /// Whether this part is immutable or still active.
    public let stability: Stability

    /// How spacing should be applied before this part.
    public let leadingBoundary: LeadingBoundary

    init(
        id: MarkdownSourceID,
        source: String,
        block: MarkdownBlock,
        stability: Stability,
        leadingBoundary: LeadingBoundary = .block
    ) {
        self.id = id
        self.source = source
        self.block = block
        self.stability = stability
        self.leadingBoundary = leadingBoundary
    }
}

/// A recursive semantic Markdown block independent of the parser AST.
public struct MarkdownBlock: Identifiable, Sendable, Hashable {
    /// Supported render content for a Markdown block.
    public indirect enum Content: Sendable, Hashable {
        /// One or more consecutive prose paragraphs.
        case prose(paragraphs: [MarkdownParagraph])

        /// A heading and its inline content.
        case heading(level: Int, content: AttributedString)

        /// An unordered list.
        case unorderedList(items: [MarkdownListItem])

        /// An ordered list and its source start number.
        case orderedList(startIndex: UInt, items: [MarkdownListItem])

        /// A block quote containing recursive blocks.
        case blockQuote(blocks: [MarkdownBlock])

        /// A thematic divider.
        case thematicBreak

        /// A fenced or indented code block.
        case codeBlock(MarkdownCodeBlock)

        /// Preserved source for a syntax intentionally rendered literally.
        case literal(String)

        /// Source that contributes no visible Markdown block, such as a reference definition.
        case sourceOnly
    }

    /// The source-derived stable identity.
    public let id: MarkdownSourceID

    /// The semantic block content.
    public let content: Content

    init(id: MarkdownSourceID, content: Content) {
        self.id = id
        self.content = content
    }
}

/// One inline-styled paragraph inside a prose block.
public struct MarkdownParagraph: Identifiable, Sendable, Hashable {
    /// The source-derived stable identity.
    public let id: MarkdownSourceID

    /// Inline content ready for SwiftUI `Text`.
    public let content: AttributedString

    init(id: MarkdownSourceID, content: AttributedString) {
        self.id = id
        self.content = content
    }
}

/// One recursive item inside an ordered or unordered list.
public struct MarkdownListItem: Identifiable, Sendable, Hashable {
    /// Task-list state parsed from the item marker.
    public enum Checkbox: Sendable, Hashable {
        /// The task is checked.
        case checked

        /// The task is unchecked.
        case unchecked
    }

    /// The source-derived stable identity.
    public let id: MarkdownSourceID

    /// Optional task-list state.
    public let checkbox: Checkbox?

    /// Recursive blocks in the list item.
    public let blocks: [MarkdownBlock]

    init(id: MarkdownSourceID, checkbox: Checkbox?, blocks: [MarkdownBlock]) {
        self.id = id
        self.checkbox = checkbox
        self.blocks = blocks
    }
}

/// Render content for a fenced or indented code block.
public struct MarkdownCodeBlock: Sendable, Hashable {
    /// The code without fence markers.
    public let code: String

    /// The optional fenced-code info string language.
    public let language: String?

    init(code: String, language: String?) {
        self.code = code
        self.language = language
    }
}
