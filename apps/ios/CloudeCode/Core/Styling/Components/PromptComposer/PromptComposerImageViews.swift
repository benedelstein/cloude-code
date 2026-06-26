import SwiftUI
import UIKit

extension PromptComposerView {
    struct ImageSourceMenu: View {
        @Environment(\.composerStyle) var composerStyle: ComposerStyle
        @Environment(\.theme) private var theme
        @Environment(\.style) private var style

        let isDisabled: Bool
        let onOpenCamera: () -> Void
        let onOpenPhotos: () -> Void

        var body: some View {
            Menu {
                Button(action: onOpenCamera) {
                    Label("Camera", systemImage: "camera")
                }
                .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))

                Button(action: onOpenPhotos) {
                    Label("Photos", systemImage: "photo.on.rectangle")
                }
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 17, weight: .semibold))
                    .squareFrame(size: composerStyle.bottomButtonSize)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.secondaryLabelColor)
            .disabled(isDisabled)
            .accessibilityLabel("Add images")
        }
    }

    struct AttachmentPreviews: View {
        @Environment(\.theme) private var theme
        @Environment(\.style) private var style

        let attachments: [PromptComposerImageAttachmentPreview]
        let errorMessage: String?
        let onRemove: (UUID) -> Void

        var body: some View {
            VStack(alignment: .leading, spacing: style.gridSize) {
                if !attachments.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: style.gridSize) {
                            ForEach(attachments) { attachment in
                                AttachmentThumbnail(attachment: attachment) {
                                    withAnimation {
                                        onRemove(attachment.id)
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 12)
                        .padding(.bottom, 2)
                    }
                }

                if let errorMessage, !errorMessage.isEmpty {
                    Text(errorMessage)
                        .styledFont(.caption)
                        .foregroundStyle(theme.errorRed)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 4)
                }
            }
        }
    }
}

extension PromptComposerView {
    private struct AttachmentThumbnail: View {
        @Environment(\.theme) private var theme
        @Environment(\.style) private var style

        let attachment: PromptComposerImageAttachmentPreview
        let onRemove: () -> Void

        var body: some View {
            ZStack(alignment: .topTrailing) {
                thumbnailImage
                    .frame(width: style.gridSize * 8, height: style.gridSize * 8)
                    .clipShape(shape)
                    .overlay {
                        shape.stroke(outlineColor, lineWidth: style.outlineThickness)
                    }

                statusOverlay

                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(theme.labelColor)
                        .frame(width: 20, height: 20)
                        .background(Circle().fill(theme.backgroundColor.opacity(0.86)))
                }
                .buttonStyle(.plain)
                .padding(4)
                .accessibilityLabel("Remove image")
            }
            .frame(width: style.gridSize * 8, height: style.gridSize * 8)
        }

        @ViewBuilder
        private var thumbnailImage: some View {
            if let previewData = attachment.previewData,
               let image = UIImage(data: previewData) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "photo")
                    .foregroundStyle(theme.secondaryLabelColor)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(theme.loadingBackgroundColor)
            }
        }

        @ViewBuilder
        private var statusOverlay: some View {
            switch attachment.status {
            case .uploading:
                ZStack {
                    Rectangle()
                        .fill(.black.opacity(0.4))
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white)
                }
                .clipShape(shape)
            case .uploaded:
                EmptyView()
            case .failed:
                Text("Failed")
                    .styledFont(.caption2)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(theme.errorRed))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    .padding(4)
            }
        }

        private var shape: RoundedRectangle {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
        }

        private var outlineColor: Color {
            if case .failed = attachment.status {
                return theme.errorRed
            }
            return theme.outlineColor
        }
    }
}
