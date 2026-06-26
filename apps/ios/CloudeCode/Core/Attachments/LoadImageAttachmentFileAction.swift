import API
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Converts picker and camera images into uploadable attachment files.
actor LoadImageAttachmentFileAction {
    /// Encodes a camera image as JPEG data for upload.
    func callAsFunction(from image: UIImage) async -> AttachmentUploadFile? {
        guard let data = image.jpegData(compressionQuality: 0.9) else {
            return nil
        }
        return AttachmentUploadFile(
            data: data,
            filename: "camera-\(UUID().uuidString.lowercased()).jpg",
            mediaType: "image/jpeg"
        )
    }

    /// Loads a selected Photos item into memory for preview and upload.
    func callAsFunction(from item: PhotosPickerItem) async throws -> AttachmentUploadFile? {
        guard let data = try await item.loadTransferable(type: Data.self) else {
            return nil
        }
        let contentType = item.supportedContentTypes.first { $0.conforms(to: .image) } ?? .jpeg
        let fileExtension = contentType.preferredFilenameExtension ?? "jpg"
        let mediaType = contentType.preferredMIMEType ?? "image/jpeg"
        return AttachmentUploadFile(
            data: data,
            filename: "image-\(UUID().uuidString.lowercased()).\(fileExtension)",
            mediaType: mediaType
        )
    }
}
