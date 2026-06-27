import CoreAPI
import Domain
import Foundation

/// Image file payload sent to the attachment upload endpoint.
public struct AttachmentUploadFile: Sendable, Equatable {
    public let data: Data
    public let filename: String
    public let mediaType: String

    /// Creates an uploadable image payload.
    public init(data: Data, filename: String, mediaType: String) {
        self.data = data
        self.filename = filename
        self.mediaType = mediaType
    }
}

private struct UploadAttachments: MultipartAPIRequest {
    typealias Response = UploadAttachmentResponse

    var sessionId: String?
    var files: [AttachmentUploadFile]
    var headers: [String: String]

    var path: String { "attachments" }
    var method: HTTPMethod { .post }
    var parts: [MultipartFormPart] {
        var uploadParts: [MultipartFormPart] = []
        if let sessionId {
            uploadParts.append(.field(name: "sessionId", value: sessionId))
        }
        // Multipart sends multiple files as repeated parts. The server reads
        // each `File` value from the form data and stores them as attachments.
        uploadParts.append(contentsOf: files.map { file in
            .file(
                name: "files",
                filename: file.filename,
                contentType: file.mediaType,
                data: file.data
            )
        })
        return uploadParts
    }
}

private struct DeleteAttachment: APIRequest {
    typealias Response = EmptyResponse

    var attachmentId: String
    var headers: [String: String]

    var path: String { "attachments/\(attachmentId)" }
    var method: HTTPMethod { .delete }
}

/// HTTP API for uploading and deleting image attachments.
public protocol AttachmentsAPIProviding: Sendable {
    /// Uploads image files and optionally binds them to a session.
    /// - Parameters:
    ///   - files: Image files to upload as multipart form data.
    ///   - sessionId: Optional session id to bind attachments to at upload time.
    /// - Returns: Uploaded attachment descriptors.
    func uploadImages(_ files: [AttachmentUploadFile], sessionId: String?) async throws -> [UploadedAttachment]

    /// Deletes an attachment owned by the current user.
    /// - Parameter attachmentId: Attachment id to delete.
    func deleteAttachment(id attachmentId: String) async throws
}

/// Authenticated attachments API implementation.
public struct AttachmentsAPI: AttachmentsAPIProviding {
    private let client: APIClient
    private let tokenProvider: any AuthTokenProviding

    /// Creates an attachments API.
    public init(client: APIClient, tokenProvider: any AuthTokenProviding) {
        self.client = client
        self.tokenProvider = tokenProvider
    }

    /// Uploads image files and optionally binds them to a session.
    public func uploadImages(_ files: [AttachmentUploadFile], sessionId: String?) async throws -> [UploadedAttachment] {
        let response = try await client.fetchMultipart(UploadAttachments(
            sessionId: sessionId,
            files: files,
            headers: tokenProvider.bearerHeaders()
        ))
        return response.attachments.map(UploadedAttachment.init)
    }

    /// Deletes an attachment owned by the current user.
    public func deleteAttachment(id attachmentId: String) async throws {
        _ = try await client.fetch(DeleteAttachment(
            attachmentId: attachmentId,
            headers: tokenProvider.bearerHeaders()
        ))
    }
}

private extension UploadedAttachment {
    init(_ descriptor: AttachmentDescriptor) {
        self.init(
            attachmentId: descriptor.attachmentId,
            filename: descriptor.filename,
            mediaType: descriptor.mediaType,
            sizeBytes: descriptor.sizeBytes,
            width: descriptor.width,
            height: descriptor.height,
            contentUrl: descriptor.contentUrl
        )
    }
}
