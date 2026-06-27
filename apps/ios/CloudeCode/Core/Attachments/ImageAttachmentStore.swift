import API
import Domain
import Foundation
import PhotosUI
import SwiftUI
import UIKit

/// Upload state for an image draft shown in the composer.
enum ImageAttachmentDraftStatus: Equatable {
    case uploading
    case uploaded
    case failed(String)

    var isUploaded: Bool {
        self == .uploaded
    }
}

/// Local composer model for one image attachment before it is submitted.
struct ImageAttachmentDraft: Identifiable {
    let id: UUID
    /// Nil while a selected Photos item is still loading into memory.
    var file: AttachmentUploadFile?
    /// Downsampled thumbnail used by the composer preview strip.
    var previewImage: UIImage?
    var status: ImageAttachmentDraftStatus
    /// Server-side upload result used when sending the final prompt.
    var descriptor: UploadedAttachment?
}

/// Owns image attachment drafts from local selection through server upload.
@MainActor
@Observable
final class ImageAttachmentStore {
    private enum Constants {
        static let maxAttachments = 5
        static let maxAttachmentBytes = 10 * 1024 * 1024
    }

    private let sessionId: String?
    private let attachmentsAPI: any AttachmentsAPIProviding
    @ObservationIgnored private let loadImageAttachmentFile: LoadImageAttachmentFileAction
    // Removed uploads may still finish; keep their ids so the returned server
    // attachment can be deleted instead of becoming orphaned.
    @ObservationIgnored private var removedUploadingDraftIds: Set<UUID> = []
    @ObservationIgnored private var uploadTasks: [UUID: Task<Void, Never>] = [:]

    private(set) var attachments: [ImageAttachmentDraft] = []
    private(set) var errorMessage: String?

    var uploadedDescriptors: [UploadedAttachment] {
        attachments.compactMap(\.descriptor)
    }

    var hasPendingOrFailedUploads: Bool {
        attachments.contains { !$0.status.isUploaded }
    }

    var remainingSlots: Int {
        max(0, Constants.maxAttachments - attachments.count)
    }

    init(
        sessionId: String?,
        attachmentsAPI: any AttachmentsAPIProviding,
        loadImageAttachmentFile: LoadImageAttachmentFileAction = LoadImageAttachmentFileAction()
    ) {
        self.sessionId = sessionId
        self.attachmentsAPI = attachmentsAPI
        self.loadImageAttachmentFile = loadImageAttachmentFile
    }

    deinit {
        uploadTasks.values.forEach { $0.cancel() }
    }

    /// Adds already-loaded image files and starts uploading accepted files.
    func addFiles(_ files: [AttachmentUploadFile]) {
        errorMessage = nil
        guard !files.isEmpty else { return }

        let acceptedFiles = validFiles(from: files)
        guard !acceptedFiles.isEmpty else { return }

        let availableSlots = remainingSlots
        guard availableSlots > 0 else {
            errorMessage = "You can attach up to \(Constants.maxAttachments) images."
            return
        }

        let filesToUpload = Array(acceptedFiles.prefix(availableSlots))
        if acceptedFiles.count > availableSlots {
            errorMessage = "You can attach up to \(Constants.maxAttachments) images."
        }

        for file in filesToUpload {
            let draft = ImageAttachmentDraft(
                id: UUID(),
                file: file,
                previewImage: nil,
                status: .uploading,
                descriptor: nil
            )
            attachments.append(draft)
            upload(draft)
        }
    }

    /// Adds selected Photos items after loading their image data into reserved placeholder rows.
    func addPhotoItems(_ items: [PhotosPickerItem]) {
        let reservationIds = reserveImageSelections(count: items.count)
        guard !reservationIds.isEmpty else { return }

        Task { [weak self, loadImageAttachmentFile] in
            for (reservationId, item) in zip(reservationIds, items) {
                do {
                    guard let loadedFile = try await loadImageAttachmentFile(from: item) else {
                        self?.failReservedFile(
                            id: reservationId,
                            message: "Failed to load image."
                        )
                        continue
                    }

                    self?.attachReservedFile(id: reservationId, loadedFile: loadedFile)
                } catch {
                    self?.failReservedFile(
                        id: reservationId,
                        message: error.localizedDescription
                    )
                }
            }
        }
    }

    /// Encodes and adds a captured camera image.
    func addCameraImage(_ image: UIImage) {
        Task { [weak self, loadImageAttachmentFile] in
            guard let loadedFile = await loadImageAttachmentFile(from: image) else {
                return
            }
            self?.addLoadedFiles([loadedFile])
        }
    }

    private func reserveImageSelections(count: Int) -> [UUID] {
        errorMessage = nil
        guard count > 0 else { return [] }

        let availableSlots = remainingSlots
        guard availableSlots > 0 else {
            errorMessage = "You can attach up to \(Constants.maxAttachments) images."
            return []
        }

        let reservationCount = min(count, availableSlots)
        if count > availableSlots {
            errorMessage = "You can attach up to \(Constants.maxAttachments) images."
        }

        let drafts = (0..<reservationCount).map { _ in
            ImageAttachmentDraft(
                id: UUID(),
                file: nil,
                previewImage: nil,
                status: .uploading,
                descriptor: nil
            )
        }
        attachments.append(contentsOf: drafts)
        return drafts.map(\.id)
    }

    /// Replaces a loading placeholder with file data and starts uploading it.
    private func attachReservedFile(id: UUID, loadedFile: LoadedImageAttachmentFile) {
        guard let index = attachments.firstIndex(where: { $0.id == id }) else {
            return
        }

        guard let validFile = validFile(loadedFile.file) else {
            attachments[index].status = .failed("Invalid image.")
            return
        }

        attachments[index].file = validFile
        attachments[index].previewImage = loadedFile.previewImage
        attachments[index].status = .uploading
        upload(attachments[index])
    }

    /// Marks a loading placeholder as failed when local file loading fails.
    private func failReservedFile(id: UUID, message: String) {
        guard let index = attachments.firstIndex(where: { $0.id == id }) else {
            return
        }

        attachments[index].status = .failed(message)
        errorMessage = message
    }

    /// Removes a composer image and deletes uploaded server data when needed.
    func removeAttachment(id: UUID) {
        guard let index = attachments.firstIndex(where: { $0.id == id }) else {
            return
        }

        let draft = attachments.remove(at: index)
        switch draft.status {
        case .uploaded:
            if let descriptor = draft.descriptor {
                deleteUploadedAttachment(descriptor)
            }
        case .uploading:
            if draft.file != nil {
                // Let the upload finish so markUploaded can delete the remote
                // attachment if the server accepted it before removal.
                removedUploadingDraftIds.insert(id)
            }
        case .failed:
            uploadTasks[id]?.cancel()
            uploadTasks[id] = nil
        }
    }

    /// Clears local composer attachments after creating the optimistic message.
    func clearAfterSubmit() {
        attachments.removeAll()
        errorMessage = nil
    }

    /// Restores composer attachments when a send fails after optimistic clear.
    func restore(_ submittedAttachments: [ImageAttachmentDraft]) {
        attachments = submittedAttachments
    }

    private func validFiles(from files: [AttachmentUploadFile]) -> [AttachmentUploadFile] {
        files.compactMap(validFile)
    }

    private func validFile(_ file: AttachmentUploadFile) -> AttachmentUploadFile? {
        guard file.mediaType.hasPrefix("image/") else {
            return nil
        }

        guard file.data.count <= Constants.maxAttachmentBytes else {
            errorMessage = "\"\(file.filename)\" exceeds 10 MB."
            return nil
        }

        return file
    }

    private func addLoadedFiles(_ files: [LoadedImageAttachmentFile]) {
        errorMessage = nil
        guard !files.isEmpty else { return }

        let availableSlots = remainingSlots
        guard availableSlots > 0 else {
            errorMessage = "You can attach up to \(Constants.maxAttachments) images."
            return
        }

        let filesToUpload = Array(files.prefix(availableSlots))
        if files.count > availableSlots {
            errorMessage = "You can attach up to \(Constants.maxAttachments) images."
        }

        for loadedFile in filesToUpload {
            guard let validFile = validFile(loadedFile.file) else { continue }
            let draft = ImageAttachmentDraft(
                id: UUID(),
                file: validFile,
                previewImage: loadedFile.previewImage,
                status: .uploading,
                descriptor: nil
            )
            attachments.append(draft)
            upload(draft)
        }
    }

    private func upload(_ draft: ImageAttachmentDraft) {
        guard let file = draft.file else { return }
        uploadTasks[draft.id] = Task { [weak self, draft] in
            guard let self else { return }
            do {
                let descriptors = try await attachmentsAPI.uploadImages([file], sessionId: sessionId)
                guard let descriptor = descriptors.first else {
                    throw APIError.invalidResponse
                }
                markUploaded(draftId: draft.id, descriptor: descriptor)
            } catch {
                markFailed(draftId: draft.id, error: error)
            }
        }
    }

    private func markUploaded(draftId: UUID, descriptor: UploadedAttachment) {
        uploadTasks[draftId] = nil
        if removedUploadingDraftIds.remove(draftId) != nil {
            deleteUploadedAttachment(descriptor)
            return
        }

        guard let index = attachments.firstIndex(where: { $0.id == draftId }) else {
            deleteUploadedAttachment(descriptor)
            return
        }

        attachments[index].descriptor = descriptor
        attachments[index].status = .uploaded
    }

    private func markFailed(draftId: UUID, error: any Error) {
        uploadTasks[draftId] = nil
        guard removedUploadingDraftIds.remove(draftId) == nil,
              let index = attachments.firstIndex(where: { $0.id == draftId }) else {
            return
        }

        attachments[index].status = .failed(error.localizedDescription)
    }

    private func deleteUploadedAttachment(_ descriptor: UploadedAttachment) {
        Task.detached { [attachmentsAPI] in
            do {
                try await attachmentsAPI.deleteAttachment(id: descriptor.attachmentId)
            } catch {
                Logger.warning("Failed to delete removed attachment:", error)
            }
        }
    }
}
