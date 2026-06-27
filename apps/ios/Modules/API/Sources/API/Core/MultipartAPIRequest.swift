import Foundation

struct MultipartFormPart: Sendable, Equatable {
    let name: String
    let filename: String?
    let contentType: String?
    let data: Data

    static func field(name: String, value: String) -> MultipartFormPart {
        MultipartFormPart(
            name: name,
            filename: nil,
            contentType: nil,
            data: Data(value.utf8)
        )
    }

    static func file(name: String, filename: String, contentType: String, data: Data) -> MultipartFormPart {
        MultipartFormPart(
            name: name,
            filename: filename,
            contentType: contentType,
            data: data
        )
    }
}

protocol MultipartAPIRequest: Sendable {
    associatedtype Response: Decodable & Sendable

    var path: String { get }
    var method: HTTPMethod { get }
    var queryItems: [URLQueryItem] { get }
    var headers: [String: String] { get }
    var parts: [MultipartFormPart] { get }
}

extension MultipartAPIRequest {
    var queryItems: [URLQueryItem] { [] }
    var headers: [String: String] { [:] }
}

enum MultipartFormDataEncoder {
    static func encode(parts: [MultipartFormPart], boundary: String) -> Data {
        var data = Data()
        for part in parts {
            // Each part starts with the same boundary marker. The matching
            // Content-Type header lets the server split the raw body back into
            // these individual fields and files.
            data.appendString("--\(boundary)\r\n")
            data.appendString(dispositionHeader(for: part))
            if let contentType = part.contentType {
                data.appendString("Content-Type: \(contentType)\r\n")
            }
            // A blank CRLF line separates part headers from the part bytes.
            data.appendString("\r\n")
            data.append(part.data)
            data.appendString("\r\n")
        }
        // The trailing "--" marks the final boundary; without it the server may
        // treat the body as incomplete.
        data.appendString("--\(boundary)--\r\n")
        return data
    }

    private static func dispositionHeader(for part: MultipartFormPart) -> String {
        var value = "Content-Disposition: form-data; name=\"\(escapedHeaderParameter(part.name))\""
        if let filename = part.filename {
            value.append("; filename=\"\(escapedHeaderParameter(filename))\"")
        }
        value.append("\r\n")
        return value
    }

    private static func escapedHeaderParameter(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            // Header parameters are single-line quoted strings. Remove line
            // breaks so a filename cannot accidentally create another header.
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
    }
}

private extension Data {
    mutating func appendString(_ string: String) {
        append(Data(string.utf8))
    }
}
