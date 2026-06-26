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
            data.appendString("--\(boundary)\r\n")
            data.appendString(dispositionHeader(for: part))
            if let contentType = part.contentType {
                data.appendString("Content-Type: \(contentType)\r\n")
            }
            data.appendString("\r\n")
            data.append(part.data)
            data.appendString("\r\n")
        }
        data.appendString("--\(boundary)--\r\n")
        return data
    }

    private static func dispositionHeader(for part: MultipartFormPart) -> String {
        var value = "Content-Disposition: form-data; name=\"\(escaped(part.name))\""
        if let filename = part.filename {
            value.append("; filename=\"\(escaped(filename))\"")
        }
        value.append("\r\n")
        return value
    }

    private static func escaped(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }
}

private extension Data {
    mutating func appendString(_ string: String) {
        append(Data(string.utf8))
    }
}
