import CoreAPI
import Foundation
import Testing

@Suite("UI message wire unions")
struct UIMessageWireTests {
    @Test func exactChunkDecodesAndReencodes() throws {
        let chunk = try decode(WireUIMessageChunk.self, from: #"{"type":"text-delta","id":"text-1","delta":"Hi"}"#)

        guard case .textDelta(let payload) = chunk else {
            Issue.record("Expected textDelta chunk")
            return
        }
        #expect(payload.delta == "Hi")
        #expect(try encodedJSON(chunk)["type"]?.stringValue == "text-delta")
    }

    @Test func prefixChunkDecodesAndReencodesOriginalType() throws {
        let chunk = try decode(
            WireUIMessageChunk.self,
            from: #"{"type":"data-progress","id":"progress-1","data":{"percent":50}}"#
        )

        guard case .data(let payload) = chunk else {
            Issue.record("Expected data chunk")
            return
        }
        #expect(payload.type == "data-progress")
        #expect(try encodedJSON(chunk)["type"]?.stringValue == "data-progress")
    }

    @Test func unknownChunkPreservesRawJSON() throws {
        let chunk = try decode(
            WireUIMessageChunk.self,
            from: #"{"type":"future-chunk","payload":{"opaque":true}}"#
        )

        guard case .unknown(let type, let rawValue) = chunk else {
            Issue.record("Expected unknown chunk")
            return
        }
        #expect(type == "future-chunk")
        #expect(rawValue["payload"]?["opaque"]?.boolValue == true)
        #expect(try encodedJSON(chunk)["payload"]?["opaque"]?.boolValue == true)
    }

    @Test func malformedKnownChunkThrows() {
        do {
            _ = try decode(WireUIMessageChunk.self, from: #"{"type":"text-delta","id":"text-1"}"#)
            Issue.record("Expected malformed text-delta to fail decoding")
        } catch {}
    }

    @Test func prefixPartDecodesAndReencodesOriginalType() throws {
        let part = try decode(
            WireUIMessagePart.self,
            from: #"{"type":"tool-bash","toolCallId":"call-1","state":"output-available","output":"ok"}"#
        )

        guard case .tool(let payload) = part else {
            Issue.record("Expected tool part")
            return
        }
        #expect(payload.type == "tool-bash")
        #expect(try encodedJSON(part)["type"]?.stringValue == "tool-bash")
    }
}

private func decode<T: Decodable>(_ type: T.Type, from json: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(json.utf8))
}

private func encodedJSON<T: Encodable>(_ value: T) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
}
