//
//  AgentSessionView+ComposerView.swift
//  CloudeCode
//
//  Created by Ben Edelstein on 6/26/26.
//

import Foundation
import SwiftUI

extension AgentSessionView {
    struct ComposerView: View {
        @Bindable var vm: AgentSessionViewModel
        @State private var composerFocused = false

        var body: some View {
            PromptComposerView(
                text: $vm.draftText,
                focused: $composerFocused,
                placeholder: vm.composerPlaceholder,
                imageAttachments: vm.imageAttachmentDrafts.map(\.promptComposerPreview),
                imageAttachmentErrorMessage: vm.imageAttachmentErrorMessage,
                remainingImageSlots: vm.remainingImageAttachmentSlots,
                isImageInputEnabled: true,
                isSubmitDisabled: !vm.canSubmitDraft,
                isSubmitting: vm.isResponding,
                onSubmit: vm.submitDraft,
                onRemoveImageAttachment: vm.removeImageAttachment,
                onPhotosSelected: vm.addImageAttachmentPhotoItems,
                onCameraImageCaptured: vm.addImageAttachmentCameraImage
            )
        }
    }
}

private extension ImageAttachmentDraft {
    var promptComposerPreview: PromptComposerImageAttachmentPreview {
        PromptComposerImageAttachmentPreview(
            id: id,
            previewImage: previewImage,
            status: status
        )
    }
}
