import Domain

struct NormalizableToolPart: Sendable, Equatable {
    let toolName: String
    let toolCallId: String
    let state: String
    let input: JSONValue?
    let output: JSONValue?
    let errorText: String?

    init?(_ part: SessionMessage.Part) {
        switch part {
        case .dynamicTool(let tool):
            self.init(
                toolName: tool.toolName,
                toolCallId: tool.toolCallId,
                state: tool.state,
                input: tool.input,
                output: tool.output,
                errorText: tool.errorText
            )
        case .tool(let tool):
            self.init(
                toolName: Self.toolName(from: tool.type),
                toolCallId: tool.toolCallId,
                state: tool.state,
                input: tool.input ?? tool.rawInput,
                output: tool.output,
                errorText: tool.errorText
            )
        case .text, .reasoning, .sourceURL, .sourceDocument, .file, .stepStart, .data, .unknown:
            return nil
        }
    }

    init(
        toolName: String,
        toolCallId: String = "call-1",
        state: String = "output-available",
        input: JSONValue? = nil,
        output: JSONValue? = nil,
        errorText: String? = nil
    ) {
        self.toolName = toolName
        self.toolCallId = toolCallId
        self.state = state
        self.input = input
        self.output = output
        self.errorText = errorText
    }

    private static func toolName(from type: String) -> String {
        if type.hasPrefix("tool-") {
            return String(type.dropFirst("tool-".count))
        }
        return type
    }
}
