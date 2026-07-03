import Domain
import Foundation

/// A normalized transcript row fragment that SwiftUI can render inside an assistant message.
enum AgentSessionRenderItem: Sendable, Equatable, Identifiable {
    case text(TextItem)
    case chunkedText(ChunkedTextItem)
    case reasoning(ReasoningItem)
    case actionItem(ActionItem)

    /// Stable render key used by transcript diffing and SwiftUI identity.
    var key: String {
        switch self {
        case .text(let item):
            item.key
        case .chunkedText(let item):
            item.key
        case .reasoning(let item):
            item.key
        case .actionItem(let item):
            item.key
        }
    }

    /// Identifiable conformance backed by the stable render key.
    var id: String {
        key
    }
}

extension AgentSessionRenderItem {
    /// Returns whether this render item displays assistant prose.
    var isText: Bool {
        if case .text = self {
            return true
        }
        if case .chunkedText = self {
            return true
        }
        return false
    }
}

extension AgentSessionRenderItem {
    /// Raw assistant text before markdown render derivation.
    struct TextItem: Sendable, Equatable, Hashable {
        let key: String
        let text: String
    }

    /// Markdown-aware assistant text with raw source retained for copy/detail behavior.
    struct ChunkedTextItem: Sendable, Hashable {
        let key: String
        let text: String
        let parts: [MarkdownTextPart]
    }

    /// Assistant reasoning text that remains visually distinct from the final response.
    struct ReasoningItem: Sendable, Equatable {
        let key: String
        let part: SessionMessage.ReasoningPart
    }

    /// A normalized tool action, either standalone or grouped with related actions.
    enum ActionItem: Sendable, Equatable {
        case group(ActionGroup)
        case single(SingleAction)

        /// Stable render key for the normalized action item.
        var key: String {
            switch self {
            case .group(let group):
                group.key
            case .single(let action):
                action.key
            }
        }
    }

    /// A grouped set of related normalized tool actions.
    struct ActionGroup: Sendable, Equatable {
        let kind: ToolKind
        var actions: [NormalizedToolAction]
        let key: String
    }

    /// A single normalized tool action.
    struct SingleAction: Sendable, Equatable {
        let action: NormalizedToolAction
        let key: String
    }
}

/// A structured markdown transcript part emitted from one raw assistant text item.
enum MarkdownTextPart: Identifiable, Sendable, Hashable {
    case richText(MarkdownRichTextPart)
    case codeBlock(MarkdownCodeBlockPart)

    /// Stable part id within a text item.
    var id: Int {
        switch self {
        case .richText(let part):
            part.id
        case .codeBlock(let part):
            part.id
        }
    }
}

/// Inline-markdown rich text with its original source slice.
struct MarkdownRichTextPart: Identifiable, Sendable, Hashable {
    let id: Int
    let source: String
    let attributedText: AttributedString
}

/// A fenced code block extracted from assistant markdown.
struct MarkdownCodeBlockPart: Identifiable, Sendable, Hashable {
    let id: Int
    let text: String
    let language: String?
    let isComplete: Bool
}
