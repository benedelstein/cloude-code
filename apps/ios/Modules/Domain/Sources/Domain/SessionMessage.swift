// Domain mirrors the AI SDK UI message part surface so the view layer can render rich parts.
// swiftlint:disable:next type_body_length
public struct SessionMessage: Sendable, Equatable, Codable, Identifiable {
    public typealias ProviderMetadata = [String: [String: JSONValue]]

    public enum Role: RawRepresentable, Sendable, Equatable, Codable {
        case user
        case assistant
        case system
        case unknown(String)

        public init(rawValue: String) {
            switch rawValue {
            case "user":
                self = .user
            case "assistant":
                self = .assistant
            case "system":
                self = .system
            default:
                self = .unknown(rawValue)
            }
        }

        public var rawValue: String {
            switch self {
            case .user:
                "user"
            case .assistant:
                "assistant"
            case .system:
                "system"
            case .unknown(let value):
                value
            }
        }
    }

    public struct TextPart: Sendable, Equatable, Codable {
        public let text: String
        public let state: String?
        public let providerMetadata: ProviderMetadata?

        public init(text: String, state: String? = nil, providerMetadata: ProviderMetadata? = nil) {
            self.text = text
            self.state = state
            self.providerMetadata = providerMetadata
        }
    }

    public struct ReasoningPart: Sendable, Equatable, Codable {
        public let text: String
        public let state: String?
        public let providerMetadata: ProviderMetadata?

        public init(text: String, state: String? = nil, providerMetadata: ProviderMetadata? = nil) {
            self.text = text
            self.state = state
            self.providerMetadata = providerMetadata
        }
    }

    public struct SourceURLPart: Sendable, Equatable, Codable {
        public let sourceId: String
        public let url: String
        public let title: String?
        public let providerMetadata: ProviderMetadata?

        public init(
            sourceId: String,
            url: String,
            title: String? = nil,
            providerMetadata: ProviderMetadata? = nil
        ) {
            self.sourceId = sourceId
            self.url = url
            self.title = title
            self.providerMetadata = providerMetadata
        }
    }

    public struct SourceDocumentPart: Sendable, Equatable, Codable {
        public let sourceId: String
        public let mediaType: String
        public let title: String
        public let filename: String?
        public let providerMetadata: ProviderMetadata?

        public init(
            sourceId: String,
            mediaType: String,
            title: String,
            filename: String? = nil,
            providerMetadata: ProviderMetadata? = nil
        ) {
            self.sourceId = sourceId
            self.mediaType = mediaType
            self.title = title
            self.filename = filename
            self.providerMetadata = providerMetadata
        }
    }

    public struct FilePart: Sendable, Equatable, Codable {
        public let mediaType: String
        public let filename: String?
        public let url: String
        public let width: Int?
        public let height: Int?
        public let providerMetadata: ProviderMetadata?

        public init(
            mediaType: String,
            filename: String? = nil,
            url: String,
            width: Int? = nil,
            height: Int? = nil,
            providerMetadata: ProviderMetadata? = nil
        ) {
            self.mediaType = mediaType
            self.filename = filename
            self.url = url
            self.width = width
            self.height = height
            self.providerMetadata = providerMetadata
        }
    }

    public struct DataPart: Sendable, Equatable, Codable {
        public let type: String
        public let id: String?
        public let data: JSONValue

        public init(type: String, id: String? = nil, data: JSONValue) {
            self.type = type
            self.id = id
            self.data = data
        }
    }

    public struct ToolApproval: Sendable, Equatable, Codable {
        public let id: String
        public let approved: Bool?
        public let reason: String?

        public init(id: String, approved: Bool? = nil, reason: String? = nil) {
            self.id = id
            self.approved = approved
            self.reason = reason
        }
    }

    public struct ToolPart: Sendable, Equatable, Codable {
        public let type: String
        public let toolCallId: String
        public let title: String?
        public let state: String
        public let input: JSONValue?
        public let output: JSONValue?
        public let rawInput: JSONValue?
        public let errorText: String?
        public let providerExecuted: Bool?
        public let callProviderMetadata: ProviderMetadata?
        public let resultProviderMetadata: ProviderMetadata?
        public let preliminary: Bool?
        public let approval: ToolApproval?

        public init(
            type: String,
            toolCallId: String,
            title: String? = nil,
            state: String,
            input: JSONValue? = nil,
            output: JSONValue? = nil,
            rawInput: JSONValue? = nil,
            errorText: String? = nil,
            providerExecuted: Bool? = nil,
            callProviderMetadata: ProviderMetadata? = nil,
            resultProviderMetadata: ProviderMetadata? = nil,
            preliminary: Bool? = nil,
            approval: ToolApproval? = nil
        ) {
            self.type = type
            self.toolCallId = toolCallId
            self.title = title
            self.state = state
            self.input = input
            self.output = output
            self.rawInput = rawInput
            self.errorText = errorText
            self.providerExecuted = providerExecuted
            self.callProviderMetadata = callProviderMetadata
            self.resultProviderMetadata = resultProviderMetadata
            self.preliminary = preliminary
            self.approval = approval
        }
    }

    public struct DynamicToolPart: Sendable, Equatable, Codable {
        public let toolName: String
        public let toolCallId: String
        public let title: String?
        public let providerExecuted: Bool?
        public let state: String
        public let input: JSONValue?
        public let output: JSONValue?
        public let errorText: String?
        public let callProviderMetadata: ProviderMetadata?
        public let resultProviderMetadata: ProviderMetadata?
        public let preliminary: Bool?
        public let approval: ToolApproval?

        public init(
            toolName: String,
            toolCallId: String,
            title: String? = nil,
            providerExecuted: Bool? = nil,
            state: String,
            input: JSONValue? = nil,
            output: JSONValue? = nil,
            errorText: String? = nil,
            callProviderMetadata: ProviderMetadata? = nil,
            resultProviderMetadata: ProviderMetadata? = nil,
            preliminary: Bool? = nil,
            approval: ToolApproval? = nil
        ) {
            self.toolName = toolName
            self.toolCallId = toolCallId
            self.title = title
            self.providerExecuted = providerExecuted
            self.state = state
            self.input = input
            self.output = output
            self.errorText = errorText
            self.callProviderMetadata = callProviderMetadata
            self.resultProviderMetadata = resultProviderMetadata
            self.preliminary = preliminary
            self.approval = approval
        }
    }

    public struct UnknownPart: Sendable, Equatable, Codable {
        public let type: String
        public let rawValue: JSONValue

        public init(type: String, rawValue: JSONValue) {
            self.type = type
            self.rawValue = rawValue
        }
    }

    public enum Part: Sendable, Equatable, Codable {
        case text(TextPart)
        case reasoning(ReasoningPart)
        case sourceURL(SourceURLPart)
        case sourceDocument(SourceDocumentPart)
        case file(FilePart)
        case stepStart
        case dynamicTool(DynamicToolPart)
        case data(DataPart)
        case tool(ToolPart)
        case unknown(UnknownPart)

        public var textValue: String? {
            guard case .text(let payload) = self else {
                return nil
            }
            return payload.text
        }
    }

    public let id: String
    public let role: Role
    public let parts: [Part]
    public let metadata: JSONValue?

    public var isUser: Bool {
        role == .user
    }

    public var text: String {
        parts.compactMap(\.textValue).joined(separator: "\n\n")
    }

    public init(id: String, role: Role, parts: [Part], metadata: JSONValue? = nil) {
        self.id = id
        self.role = role
        self.parts = parts
        self.metadata = metadata
    }

    public init(id: String, role: Role, text: String, metadata: JSONValue? = nil) {
        self.init(
            id: id,
            role: role,
            parts: text.isEmpty ? [] : [.text(TextPart(text: text))],
            metadata: metadata
        )
    }
}
