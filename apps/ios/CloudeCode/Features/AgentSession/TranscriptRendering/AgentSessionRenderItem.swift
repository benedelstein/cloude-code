import Domain
import Foundation
import MarkdownParsing

/// A normalized transcript row fragment that SwiftUI can render inside an assistant message.
enum AgentSessionRenderItem: Sendable, Equatable, Identifiable {
    case text(TextItem)
    case markdown(MarkdownItem)
    case reasoning(ReasoningItem)
    case actionItem(ActionItem)

    /// Stable render key used by transcript diffing and SwiftUI identity.
    var key: String {
        switch self {
        case .text(let item):
            item.key
        case .markdown(let item):
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
        if case .markdown = self {
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
    ///
    /// Parts stay nested under one item because a single raw text part streams in over time:
    /// its stable `key` anchors transcript diffing and the render cache while the derived
    /// `parts` array keeps changing (the active tail re-parses and re-splits every tick).
    /// Flattening parts into top-level render items would leak that churn into transcript
    /// identity and lose the raw `text` needed for copy and the detail sheet.
    struct MarkdownItem: Sendable, Hashable {
        let key: String
        let text: String
        let parts: [MarkdownPart]
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
