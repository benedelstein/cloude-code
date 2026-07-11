import Foundation
import PhotosUI
import SwiftUI
import UIKit

extension AgentSessionViewModel {
    /// Image drafts currently shown by the composer attachment strip.
    var imageAttachmentDrafts: [ImageAttachmentDraft] {
        attachmentStore.attachments
    }

    /// Transient composer error for image selection or validation failures.
    var imageSelectionErrorMessage: String? {
        attachmentStore.errorMessage
    }

    /// Number of additional image attachments the composer can accept.
    var remainingImageAttachmentSlots: Int {
        attachmentStore.remainingSlots
    }

    /// Adds selected Photos items and starts uploading each loaded image.
    func addImageAttachmentPhotoItems(_ items: [PhotosPickerItem]) {
        attachmentStore.addPhotoItems(items)
    }

    /// Adds a captured camera image and starts uploading it.
    func addImageAttachmentCameraImage(_ image: UIImage) {
        attachmentStore.addCameraImage(image)
    }

    /// Removes an image draft from the composer and cleans up uploaded data if needed.
    func removeImageAttachment(id: UUID) {
        attachmentStore.removeAttachment(id: id)
    }

    /// Retries a failed image attachment upload.
    func retryImageAttachment(id: UUID) {
        attachmentStore.retryAttachment(id: id)
    }
}
