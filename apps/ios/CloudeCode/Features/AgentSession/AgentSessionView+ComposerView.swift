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
        @Environment(\.style) var style: Style

        @Bindable var vm: AgentSessionViewModel
        @State private var composerFocused = false

        var body: some View {
            VStack(alignment: .leading, spacing: 8) {
                if vm.isDraftMode, !vm.isCreatingSession, let draft = vm.draft {
                    RepoBranchPickerBar(draft: draft)
                        .transition(style.fadeTransition)
                }

                promptComposer {
                    ModelPickerButton(
                        modelPicker: vm.modelPicker,
                        providerId: vm.modelProviderId,
                        restrictsProvider: vm.isCreatingSession || !vm.isDraftMode,
                        isLoadingSelection: vm.isModelSelectionLoading
                    )
                }
            }
            .task {
                if vm.isDraftMode {
                    try? await Task.sleep(for: .milliseconds(100))
                    composerFocused = true
                }
            }
        }

        private func promptComposer<TrailingAccessory: View>(
            @ViewBuilder trailingAccessory: () -> TrailingAccessory = { EmptyView() }
        ) -> some View {
            PromptComposerView(
                text: $vm.draftText,
                focused: $composerFocused,
                placeholder: vm.composerPlaceholder,
                imageAttachments: vm.imageAttachmentDrafts.map(\.promptComposerPreview),
                imageSelectionErrorMessage: vm.imageSelectionErrorMessage,
                remainingImageSlots: vm.remainingImageAttachmentSlots,
                isImageInputEnabled: true,
                isSubmitDisabled: !vm.canSubmitDraft,
                isSubmitting: vm.isCreatingSession || vm.isResponding,
                trailingAccessory: trailingAccessory,
                onSubmit: vm.submitDraft,
                onRemoveImageAttachment: vm.removeImageAttachment,
                onRetryImageAttachment: vm.retryImageAttachment,
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
            status: status,
            canRetry: file != nil && status.isFailed
        )
    }
}
