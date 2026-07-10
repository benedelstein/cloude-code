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

        private var showsRepoBranchPicker: Bool {
            vm.isDraftMode && !vm.isCreatingSession && vm.draft != nil
        }

        var body: some View {
            VStack(alignment: .leading, spacing: 8) {
                if showsRepoBranchPicker, let draft = vm.draft {
                    RepoBranchPickerBar(draft: draft)
                        .transition(style.fadeTransition)
                }

                promptComposer {
                    ModelPickerButton(
                        modelCatalog: vm.modelCatalogStore,
                        selectedModel: vm.modelSelection,
                        providerId: vm.modelProviderId,
                        restrictsProvider: vm.isCreatingSession || !vm.isDraftMode,
                        isLoadingSelection: vm.isModelSelectionLoading,
                        onSelectModel: { provider, model in
                            vm.selectModel(provider: provider, model: model)
                        },
                        onSelectEffort: { provider, effort in
                            vm.selectEffort(provider: provider, effort: effort)
                        }
                    )
                }
            }
            // Explicit animation: transition-only animations stopped firing on
            // iOS 26, and this also animates the layout shift when the bar
            // appears or disappears.
            .animation(style.fadeAnimation, value: showsRepoBranchPicker)
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
                onSubmit: vm.submitUserMessage,
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
