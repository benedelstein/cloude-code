import AISDKProvider
import CoreAPI
import Domain
import SwiftAISDK

extension Domain.JSONValue {
    init(_ value: CoreAPI.JSONValue) {
        switch value {
        case .string(let string):
            self = .string(string)
        case .number(let number):
            self = .number(number)
        case .bool(let bool):
            self = .bool(bool)
        case .object(let object):
            self = .object(object.mapValues(Domain.JSONValue.init))
        case .array(let array):
            self = .array(array.map(Domain.JSONValue.init))
        case .null:
            self = .null
        }
    }

    init(_ value: AISDKProvider.JSONValue) {
        switch value {
        case .string(let string):
            self = .string(string)
        case .number(let number):
            self = .number(number)
        case .bool(let bool):
            self = .bool(bool)
        case .object(let object):
            self = .object(object.mapValues(Domain.JSONValue.init))
        case .array(let array):
            self = .array(array.map(Domain.JSONValue.init))
        case .null:
            self = .null
        }
    }
}

extension SessionMessage.Part {
    // swiftlint:disable:next cyclomatic_complexity function_body_length
    init(_ part: CoreAPI.WireUIMessagePart) {
        switch part {
        case .text(let payload):
            self = .text(.init(
                text: payload.text,
                state: payload.state?.rawValue,
                providerMetadata: payload.providerMetadata?.domainProviderMetadata
            ))
        case .reasoning(let payload):
            self = .reasoning(.init(
                text: payload.text,
                state: payload.state?.rawValue,
                providerMetadata: payload.providerMetadata?.domainProviderMetadata
            ))
        case .sourceUrl(let payload):
            self = .sourceURL(.init(
                sourceId: payload.sourceId,
                url: payload.url,
                title: payload.title,
                providerMetadata: payload.providerMetadata?.domainProviderMetadata
            ))
        case .sourceDocument(let payload):
            self = .sourceDocument(.init(
                sourceId: payload.sourceId,
                mediaType: payload.mediaType,
                title: payload.title,
                filename: payload.filename,
                providerMetadata: payload.providerMetadata?.domainProviderMetadata
            ))
        case .file(let payload):
            self = .file(.init(
                mediaType: payload.mediaType,
                filename: payload.filename,
                url: payload.url,
                providerMetadata: payload.providerMetadata?.domainProviderMetadata
            ))
        case .stepStart:
            self = .stepStart
        case .dynamicTool(let payload):
            self = .dynamicTool(.init(
                toolName: payload.toolName,
                toolCallId: payload.toolCallId,
                title: payload.title,
                providerExecuted: payload.providerExecuted,
                state: payload.state.rawValue,
                input: payload.input.map(Domain.JSONValue.init),
                output: payload.output.map(Domain.JSONValue.init),
                errorText: payload.errorText,
                callProviderMetadata: payload.callProviderMetadata?.domainProviderMetadata,
                resultProviderMetadata: payload.resultProviderMetadata?.domainProviderMetadata,
                preliminary: payload.preliminary,
                approval: payload.approval.map(SessionMessage.ToolApproval.init)
            ))
        case .data(let payload):
            self = .data(.init(
                type: payload.type,
                id: payload.id,
                data: Domain.JSONValue(payload.data)
            ))
        case .tool(let payload):
            self = .tool(.init(
                type: payload.type,
                toolCallId: payload.toolCallId,
                title: payload.title,
                state: payload.state.rawValue,
                input: payload.input.map(Domain.JSONValue.init),
                output: payload.output.map(Domain.JSONValue.init),
                rawInput: payload.rawInput.map(Domain.JSONValue.init),
                errorText: payload.errorText,
                providerExecuted: payload.providerExecuted,
                callProviderMetadata: payload.callProviderMetadata?.domainProviderMetadata,
                resultProviderMetadata: payload.resultProviderMetadata?.domainProviderMetadata,
                preliminary: payload.preliminary,
                approval: payload.approval.map(SessionMessage.ToolApproval.init)
            ))
        case .unknown(let type, let rawValue):
            self = .unknown(.init(type: type, rawValue: Domain.JSONValue(rawValue)))
        }
    }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    init(_ part: SwiftAISDK.UIMessagePart) {
        switch part {
        case .text(let payload):
            self = .text(.init(
                text: payload.text,
                state: payload.state.rawValue,
                providerMetadata: payload.providerMetadata?.domainProviderMetadata
            ))
        case .reasoning(let payload):
            self = .reasoning(.init(
                text: payload.text,
                state: payload.state.rawValue,
                providerMetadata: payload.providerMetadata?.domainProviderMetadata
            ))
        case .sourceURL(let payload):
            self = .sourceURL(.init(
                sourceId: payload.sourceId,
                url: payload.url,
                title: payload.title,
                providerMetadata: payload.providerMetadata?.domainProviderMetadata
            ))
        case .sourceDocument(let payload):
            self = .sourceDocument(.init(
                sourceId: payload.sourceId,
                mediaType: payload.mediaType,
                title: payload.title,
                filename: payload.filename,
                providerMetadata: payload.providerMetadata?.domainProviderMetadata
            ))
        case .file(let payload):
            self = .file(.init(
                mediaType: payload.mediaType,
                filename: payload.filename,
                url: payload.url,
                providerMetadata: payload.providerMetadata?.domainProviderMetadata
            ))
        case .stepStart:
            self = .stepStart
        case .dynamicTool(let payload):
            self = .dynamicTool(.init(
                toolName: payload.toolName,
                toolCallId: payload.toolCallId,
                title: payload.title,
                providerExecuted: payload.providerExecuted,
                state: payload.state.rawValue,
                input: payload.input.map(Domain.JSONValue.init),
                output: payload.output.map(Domain.JSONValue.init),
                errorText: payload.errorText,
                callProviderMetadata: payload.callProviderMetadata?.domainProviderMetadata,
                resultProviderMetadata: payload.resultProviderMetadata?.domainProviderMetadata,
                preliminary: payload.preliminary,
                approval: payload.approval.map(SessionMessage.ToolApproval.init)
            ))
        case .data(let payload):
            self = .data(.init(
                type: payload.typeIdentifier,
                id: payload.id,
                data: Domain.JSONValue(payload.data)
            ))
        case .tool(let payload):
            self = .tool(.init(
                type: payload.typeIdentifier,
                toolCallId: payload.toolCallId,
                title: payload.title,
                state: payload.state.rawValue,
                input: payload.input.map(Domain.JSONValue.init),
                output: payload.output.map(Domain.JSONValue.init),
                rawInput: payload.rawInput.map(Domain.JSONValue.init),
                errorText: payload.errorText,
                providerExecuted: payload.providerExecuted,
                callProviderMetadata: payload.callProviderMetadata?.domainProviderMetadata,
                resultProviderMetadata: payload.resultProviderMetadata?.domainProviderMetadata,
                preliminary: payload.preliminary,
                approval: payload.approval.map(SessionMessage.ToolApproval.init)
            ))
        }
    }
}

private extension SessionMessage.ToolApproval {
    init(_ approval: CoreAPI.WireUIMessagePart.DynamicToolUIMessagePart.Approval) {
        self.init(id: approval.id, approved: approval.approved, reason: approval.reason)
    }

    init(_ approval: CoreAPI.WireUIMessagePart.ToolUIMessagePart.Approval) {
        self.init(id: approval.id, approved: approval.approved, reason: approval.reason)
    }

    init(_ approval: SwiftAISDK.UIToolApproval) {
        self.init(id: approval.id, approved: approval.approved, reason: approval.reason)
    }
}

private extension Dictionary where Key == String, Value == [String: CoreAPI.JSONValue] {
    var domainProviderMetadata: SessionMessage.ProviderMetadata {
        mapValues { providerValues in
            providerValues.mapValues(Domain.JSONValue.init)
        }
    }
}

private extension Dictionary where Key == String, Value == [String: AISDKProvider.JSONValue] {
    var domainProviderMetadata: SessionMessage.ProviderMetadata {
        mapValues { providerValues in
            providerValues.mapValues(Domain.JSONValue.init)
        }
    }
}
