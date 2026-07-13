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
        let showsRepoBranchPicker: Bool
        @State private var composerFocused = false

        var body: some View {
            VStack(alignment: .leading, spacing: 8) {
                if showsRepoBranchPicker, let draft = vm.draft {
                    if draft.selectedRepo != nil {
                        EnvironmentPickerButton(draft: draft)
                            .transition(.blurReplace)
                    }

                    RepoBranchPickerBar(draft: draft)
                        .transition(.blurReplace)
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
