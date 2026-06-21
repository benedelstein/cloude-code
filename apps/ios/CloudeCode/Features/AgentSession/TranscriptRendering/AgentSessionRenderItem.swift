import Domain

enum AgentSessionRenderItem: Sendable, Equatable {
    case text(TextItem)
    case streamingText(StreamingTextItem)
    case reasoning(ReasoningItem)
    case actionItem(ActionItem)

    var key: String {
        switch self {
        case .text(let item):
            item.key
        case .streamingText(let item):
            item.key
        case .reasoning(let item):
            item.key
        case .actionItem(let item):
            item.key
        }
    }
}

extension AgentSessionRenderItem {
    var isText: Bool {
        if case .text = self {
            return true
        }
        if case .streamingText = self {
            return true
        }
        return false
    }
}

extension AgentSessionRenderItem {
    struct TextItem: Sendable, Equatable {
        let key: String
        let text: String
    }

    struct StreamingTextItem: Sendable, Equatable {
        let key: String
        let text: String
        let chunks: [StreamingTextChunk]
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

struct StreamingTextChunk: Identifiable, Sendable, Equatable {
    let id: Int
    let text: String
}
