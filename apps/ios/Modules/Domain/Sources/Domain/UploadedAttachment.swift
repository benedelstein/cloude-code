/// Image attachment uploaded to the API server and available for message sends.
public struct UploadedAttachment: Sendable, Equatable, Codable, Identifiable {
    public var id: String { attachmentId }

    public let attachmentId: String
    public let filename: String
    public let mediaType: String
    public let sizeBytes: Int
    public let width: Int?
    public let height: Int?
    public let contentUrl: String

    /// Creates an uploaded attachment descriptor.
    public init(
        attachmentId: String,
        filename: String,
        mediaType: String,
        sizeBytes: Int,
        width: Int? = nil,
        height: Int? = nil,
        contentUrl: String
    ) {
        self.attachmentId = attachmentId
        self.filename = filename
        self.mediaType = mediaType
        self.sizeBytes = sizeBytes
        self.width = width
        self.height = height
        self.contentUrl = contentUrl
    }
}
