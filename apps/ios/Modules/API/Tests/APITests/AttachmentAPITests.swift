@testable import API
import Foundation
import Testing

@Suite("Attachments API")
struct AttachmentAPITests {
    @Test func multipartEncoderIncludesFieldAndFileParts() throws {
        let body = MultipartFormDataEncoder.encode(
            parts: [
                .field(name: "sessionId", value: "123e4567-e89b-12d3-a456-426614174000"),
                .file(
                    name: "files",
                    filename: "screenshot.png",
                    contentType: "image/png",
                    data: Data("png-bytes".utf8)
                )
            ],
            boundary: "TestBoundary"
        )

        let bodyString = try #require(String(data: body, encoding: .utf8))
        #expect(bodyString.contains("--TestBoundary\r\n"))
        #expect(bodyString.contains("Content-Disposition: form-data; name=\"sessionId\""))
        #expect(bodyString.contains("123e4567-e89b-12d3-a456-426614174000"))
        #expect(bodyString.contains("Content-Disposition: form-data; name=\"files\"; filename=\"screenshot.png\""))
        #expect(bodyString.contains("Content-Type: image/png"))
        #expect(bodyString.contains("png-bytes"))
        #expect(bodyString.hasSuffix("--TestBoundary--\r\n"))
    }
}
