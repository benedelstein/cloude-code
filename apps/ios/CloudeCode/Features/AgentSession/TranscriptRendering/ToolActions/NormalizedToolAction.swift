import Domain

enum ToolKind: String, Sendable, Equatable {
    case read
    case edit
    case write
    case bash
    case search
    case web
    case todo
    case plan
    case other
}

struct NormalizedToolAction: Sendable, Equatable {
    let toolName: String
    let toolCallId: String
    let state: String
    let errorText: String?
    let payload: Payload

    var kind: ToolKind {
        payload.kind
    }
}

extension NormalizedToolAction {
    enum Payload: Sendable, Equatable {
        case read(ReadAction)
        case edit(EditAction)
        case write(WriteAction)
        case bash(BashAction)
        case search(SearchAction)
        case web(WebAction)
        case todo(TodoAction)
        case plan(PlanAction)
        case other(OtherAction)

        var kind: ToolKind {
            switch self {
            case .read:
                .read
            case .edit:
                .edit
            case .write:
                .write
            case .bash:
                .bash
            case .search:
                .search
            case .web:
                .web
            case .todo:
                .todo
            case .plan:
                .plan
            case .other:
                .other
            }
        }
    }

    struct LineRange: Sendable, Equatable {
        let start: Int
        let end: Int?
    }

    struct ReadAction: Sendable, Equatable {
        let paths: [String]
        let lineRange: LineRange?
        let content: String?
    }

    struct EditAction: Sendable, Equatable {
        let path: String
        let diff: String
    }

    struct WriteAction: Sendable, Equatable {
        let path: String
        let content: String?
        let isNew: Bool
        let deleted: Bool
    }

    struct BashAction: Sendable, Equatable {
        let command: String
        let output: String?
        let exitCode: Int?
        let status: String?
    }

    struct SearchAction: Sendable, Equatable {
        let patterns: [String]
    }

    struct WebAction: Sendable, Equatable {
        enum Kind: String, Sendable, Equatable {
            case fetch
            case search
        }

        let kind: Kind
        let url: String?
        let query: String?
    }

    struct TodoAction: Sendable, Equatable {
        let todos: JSONValue?
    }

    struct PlanAction: Sendable, Equatable {
        let plan: String
    }

    struct OtherAction: Sendable, Equatable {
        let toolName: String
        let input: JSONValue?
        let output: JSONValue?
    }
}

extension NormalizedToolAction {
    init(toolPart: NormalizableToolPart, payload: Payload) {
        self.init(
            toolName: toolPart.toolName,
            toolCallId: toolPart.toolCallId,
            state: toolPart.state,
            errorText: toolPart.errorText,
            payload: payload
        )
    }

    static func other(from toolPart: NormalizableToolPart) -> NormalizedToolAction {
        NormalizedToolAction(
            toolPart: toolPart,
            payload: .other(.init(
                toolName: toolPart.toolName,
                input: toolPart.input,
                output: toolPart.output
            ))
        )
    }
}
