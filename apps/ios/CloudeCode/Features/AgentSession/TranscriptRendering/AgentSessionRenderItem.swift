import Domain
import Foundation

enum AgentSessionRenderItem: Sendable, Equatable, Identifiable {
    case text(TextItem)
    case chunkedText(ChunkedTextItem)
    case reasoning(ReasoningItem)
    case actionItem(ActionItem)

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

    var id: String {
        key
    }
}

extension AgentSessionRenderItem {
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
    struct TextItem: Sendable, Equatable, Hashable {
        let key: String
        let text: String
    }

    struct ChunkedTextItem: Sendable, Hashable {
        let key: String
        let text: String
        let parts: [MarkdownTextPart]
    }

    struct ReasoningItem: Sendable, Equatable {
        let key: String
        let part: SessionMessage.ReasoningPart
    }

    enum ActionItem: Sendable, Equatable {
        case group(ActionGroup)
        case single(SingleAction)

        var key: String {
            switch self {
            case .group(let group):
                group.key
            case .single(let action):
                action.key
            }
        }
    }

    struct ActionGroup: Sendable, Equatable {
        let kind: ToolKind
        var actions: [NormalizedToolAction]
        let key: String
    }

    struct SingleAction: Sendable, Equatable {
        let action: NormalizedToolAction
        let key: String
    }
}

enum MarkdownTextPart: Identifiable, Sendable, Hashable {
    case richText(MarkdownRichTextPart)
    case codeBlock(MarkdownCodeBlockPart)

    var id: Int {
        switch self {
        case .richText(let part):
            part.id
        case .codeBlock(let part):
            part.id
        }
    }
}

struct MarkdownRichTextPart: Identifiable, Sendable, Hashable {
    let id: Int
    let source: String
    let attributedText: AttributedString
}

struct MarkdownCodeBlockPart: Identifiable, Sendable, Hashable {
    let id: Int
    let text: String
    let language: String?
    let isComplete: Bool
}
