import AISDKProvider
import CoreAPI
import Domain
import Foundation
import SwiftAISDK

public enum SessionMessageStreamReader {
    /// Reduces a finite set of stream chunks into the latest domain message.
    ///
    /// - Parameter chunks: Full chunk history to reduce.
    /// - Returns: The latest message emitted by the SDK reducer, or `nil` when no message is emitted.
    public static func message(from chunks: [SessionStreamChunk]) async throws -> Domain.SessionMessage? {
        try await reduction(from: chunks).message
    }

    static func emissionCount(from chunks: [SessionStreamChunk]) async throws -> Int {
        try await reduction(from: chunks).emissionCount
    }

    private static func reduction(
        from chunks: [SessionStreamChunk]
    ) async throws -> (message: Domain.SessionMessage?, emissionCount: Int) {
        let stream = AsyncThrowingStream<SwiftAISDK.AnyUIMessageChunk, Error> { continuation in
            for chunk in chunks {
                guard let sdkChunk = chunk.value.sdkChunk() else {
                    continue
                }
                continuation.yield(sdkChunk)
            }
            continuation.finish()
        }

        let sequence: SwiftAISDK.AsyncIterableStream<SwiftAISDK.UIMessage> = readUIMessageStream(stream: stream)
        var latestMessage: SessionMessage?
        var emissionCount = 0
        for try await sdkMessage in sequence {
            latestMessage = SessionMessage(aiSDKMessage: sdkMessage)
            emissionCount += 1
        }
        return (latestMessage, emissionCount)
    }
}

public struct SessionStreamChunk: Sendable, Equatable {
    let value: CoreAPI.WireUIMessageChunk

    init(_ value: CoreAPI.WireUIMessageChunk) {
        self.value = value
    }

    public var textDelta: String? {
        guard case .textDelta(let payload) = value else {
            return nil
        }
        return payload.delta
    }
}

extension CoreAPI.WireUIMessageChunk {
    // Map our api chunk type to the swift ai sdk type.
    // swiftlint:disable:next cyclomatic_complexity function_body_length
    func sdkChunk() -> SwiftAISDK.AnyUIMessageChunk? {
        switch self {
        case .textStart(let payload):
            return .textStart(id: payload.id, providerMetadata: payload.providerMetadata?.aiSDKProviderMetadata)
        case .textDelta(let payload):
            return .textDelta(
                id: payload.id,
                delta: payload.delta,
                providerMetadata: payload.providerMetadata?.aiSDKProviderMetadata
            )
        case .textEnd(let payload):
            return .textEnd(id: payload.id, providerMetadata: payload.providerMetadata?.aiSDKProviderMetadata)
        case .reasoningStart(let payload):
            return .reasoningStart(id: payload.id, providerMetadata: payload.providerMetadata?.aiSDKProviderMetadata)
        case .reasoningDelta(let payload):
            return .reasoningDelta(
                id: payload.id,
                delta: payload.delta,
                providerMetadata: payload.providerMetadata?.aiSDKProviderMetadata
            )
        case .reasoningEnd(let payload):
            return .reasoningEnd(id: payload.id, providerMetadata: payload.providerMetadata?.aiSDKProviderMetadata)
        case .error(let payload):
            return .error(errorText: payload.errorText)
        case .toolInputAvailable(let payload):
            return .toolInputAvailable(
                toolCallId: payload.toolCallId,
                toolName: payload.toolName,
                input: payload.input.aiSDKValue,
                providerExecuted: payload.providerExecuted,
                providerMetadata: payload.providerMetadata?.aiSDKProviderMetadata,
                dynamic: payload.dynamic,
                title: payload.title
            )
        case .toolInputError(let payload):
            return .toolInputError(
                toolCallId: payload.toolCallId,
                toolName: payload.toolName,
                input: payload.input.aiSDKValue,
                providerExecuted: payload.providerExecuted,
                providerMetadata: payload.providerMetadata?.aiSDKProviderMetadata,
                dynamic: payload.dynamic,
                errorText: payload.errorText,
                title: payload.title
            )
        case .toolApprovalRequest(let payload):
            return .toolApprovalRequest(approvalId: payload.approvalId, toolCallId: payload.toolCallId)
        case .toolOutputAvailable(let payload):
            return .toolOutputAvailable(
                toolCallId: payload.toolCallId,
                output: payload.output.aiSDKValue,
                providerExecuted: payload.providerExecuted,
                providerMetadata: nil,
                dynamic: payload.dynamic,
                preliminary: payload.preliminary
            )
        case .toolOutputError(let payload):
            return .toolOutputError(
                toolCallId: payload.toolCallId,
                errorText: payload.errorText,
                providerExecuted: payload.providerExecuted,
                providerMetadata: nil,
                dynamic: payload.dynamic
            )
        case .toolOutputDenied(let payload):
            return .toolOutputDenied(toolCallId: payload.toolCallId)
        case .toolInputStart(let payload):
            return .toolInputStart(
                toolCallId: payload.toolCallId,
                toolName: payload.toolName,
                providerExecuted: payload.providerExecuted,
                providerMetadata: payload.providerMetadata?.aiSDKProviderMetadata,
                dynamic: payload.dynamic,
                title: payload.title
            )
        case .toolInputDelta(let payload):
            return .toolInputDelta(toolCallId: payload.toolCallId, inputTextDelta: payload.inputTextDelta)
        case .sourceUrl(let payload):
            return .sourceUrl(
                sourceId: payload.sourceId,
                url: payload.url,
                title: payload.title,
                providerMetadata: payload.providerMetadata?.aiSDKProviderMetadata
            )
        case .sourceDocument(let payload):
            return .sourceDocument(
                sourceId: payload.sourceId,
                mediaType: payload.mediaType,
                title: payload.title,
                filename: payload.filename,
                providerMetadata: payload.providerMetadata?.aiSDKProviderMetadata
            )
        case .file(let payload):
            return .file(
                url: payload.url,
                mediaType: payload.mediaType,
                providerMetadata: payload.providerMetadata?.aiSDKProviderMetadata
            )
        case .data(let payload):
            return .data(
                SwiftAISDK.DataUIMessageChunk(
                    name: String(payload.type.dropFirst("data-".count)),
                    id: payload.id,
                    data: payload.data.aiSDKValue,
                    transient: payload.transient
                )
            )
        case .startStep:
            return .startStep
        case .finishStep:
            return .finishStep
        case .start(let payload):
            return .start(messageId: payload.messageId, messageMetadata: payload.messageMetadata?.aiSDKValue)
        case .finish(let payload):
            return .finish(
                finishReason: payload.finishReason?.aiSDKFinishReason,
                messageMetadata: payload.messageMetadata?.aiSDKValue
            )
        case .abort(let payload):
            return .abort(reason: payload.reason)
        case .messageMetadata(let payload):
            return .messageMetadata(payload.messageMetadata.aiSDKValue)
        case .unknown(let type, _):
            Logger.debug("unknown chunk: \(type)")
            return nil
        }
    }
}

extension SessionMessage {
    init(aiSDKMessage message: SwiftAISDK.UIMessage) {
        self.init(
            id: message.id,
            role: message.role.domainRole,
            parts: message.parts.map(SessionMessage.Part.init),
            metadata: message.metadata.map(Domain.JSONValue.init)
        )
    }
}

private extension CoreAPI.WireUIMessageChunk.FinishUIMessageChunk.FinishReason {
    var aiSDKFinishReason: SwiftAISDK.FinishReason? {
        switch self {
        case .length:
            .length
        case .error:
            .error
        case .stop:
            .stop
        case .contentFilter:
            .contentFilter
        case .toolCalls:
            .toolCalls
        case .other:
            .other
        case .unknown:
            nil
        }
    }
}

private extension SwiftAISDK.UIMessageRole {
    var domainRole: SessionMessage.Role {
        switch self {
        case .system:
            .system
        case .user:
            .user
        case .assistant:
            .assistant
        }
    }
}

extension Dictionary where Key == String, Value == [String: CoreAPI.JSONValue] {
    var aiSDKProviderMetadata: SwiftAISDK.ProviderMetadata {
        reduce(into: SwiftAISDK.ProviderMetadata()) { result, entry in
            result[entry.key] = entry.value.mapValues(\.aiSDKValue)
        }
    }
}

extension CoreAPI.JSONValue {
    var aiSDKValue: AISDKProvider.JSONValue {
        switch self {
        case .string(let value):
            .string(value)
        case .number(let value):
            .number(value)
        case .bool(let value):
            .bool(value)
        case .object(let value):
            .object(value.mapValues(\.aiSDKValue))
        case .array(let value):
            .array(value.map(\.aiSDKValue))
        case .null:
            .null
        }
    }
}
