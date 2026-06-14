import AISDKProvider
import CoreAPI
import Domain
import Foundation
import SwiftAISDK

public struct SessionMessageStreamState: Sendable, Equatable {
    public private(set) var chunks: [SessionStreamChunk]
    public private(set) var message: SessionMessage?
    public private(set) var errorDescription: String?

    public init(
        chunks: [SessionStreamChunk] = [],
        message: SessionMessage? = nil,
        errorDescription: String? = nil
    ) {
        self.chunks = chunks
        self.message = message
        self.errorDescription = errorDescription
    }

    public var isActive: Bool {
        !chunks.isEmpty
    }

    public var text: String {
        if let message {
            return message.text
        }
        return chunks.compactMap(\.textDelta).joined()
    }

    public static func reducing(_ chunks: [SessionStreamChunk]) async -> Self {
        await Self().appending(chunks)
    }

    public func appending(_ newChunks: [SessionStreamChunk]) async -> Self {
        var next = self
        next.chunks.append(contentsOf: newChunks)

        do {
            next.message = try await SessionMessageStreamReader.message(from: next.chunks)
            next.errorDescription = nil
        } catch {
            next.errorDescription = error.localizedDescription
        }

        return next
    }
}

public enum SessionMessageStreamReader {
    public static func message(from chunks: [SessionStreamChunk]) async throws -> SessionMessage? {
        let sdkChunks = chunks.compactMap { $0.sdkChunk() }
        guard !sdkChunks.isEmpty else {
            return nil
        }

        let stream = AsyncThrowingStream<AnyUIMessageChunk, Error> { continuation in
            for chunk in sdkChunks {
                continuation.yield(chunk)
            }
            continuation.finish()
        }

        var latest: SwiftAISDK.UIMessage?
        let messages = readUIMessageStream(message: nil as SwiftAISDK.UIMessage?, stream: stream)
        for try await message in messages {
            latest = message
        }

        return latest.map(SessionMessage.init(aiSDKMessage:))
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

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    func sdkChunk() -> AnyUIMessageChunk? {
        switch value {
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
                DataUIMessageChunk(
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
                finishReason: payload.finishReason.flatMap { FinishReason(rawValue: $0.rawValue) },
                messageMetadata: payload.messageMetadata?.aiSDKValue
            )
        case .abort(let payload):
            return .abort(reason: payload.reason)
        case .messageMetadata(let payload):
            return .messageMetadata(payload.messageMetadata.aiSDKValue)
        case .unknown:
            return nil
        }
    }
}

private extension SessionMessage {
    init(aiSDKMessage message: SwiftAISDK.UIMessage) {
        self.init(
            id: message.id,
            role: Role(rawValue: message.role.rawValue),
            text: message.parts.compactMap { $0.textValue }.joined(separator: "\n\n")
        )
    }
}

private extension SwiftAISDK.UIMessagePart {
    var textValue: String? {
        guard case .text(let textPart) = self else {
            return nil
        }
        return textPart.text
    }
}

private extension Dictionary where Key == String, Value == [String: CoreAPI.JSONValue] {
    var aiSDKProviderMetadata: SwiftAISDK.ProviderMetadata {
        reduce(into: SwiftAISDK.ProviderMetadata()) { result, entry in
            result[entry.key] = entry.value.mapValues(\.aiSDKValue)
        }
    }
}

private extension CoreAPI.JSONValue {
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
