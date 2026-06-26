import PhotosUI
import SwiftUI
import UIKit

struct PromptComposerImageAttachmentPreview: Identifiable, Equatable {
    let id: UUID
    /// Downsampled local image used for preview; nil while a picker selection is loading.
    let previewImage: UIImage?
    let status: ImageAttachmentDraftStatus

    static func == (
        lhs: PromptComposerImageAttachmentPreview,
        rhs: PromptComposerImageAttachmentPreview
    ) -> Bool {
        lhs.id == rhs.id
            && lhs.status == rhs.status
            && lhs.previewImage === rhs.previewImage
    }
}

struct PromptComposerView: View {
    @Environment(\.composerStyle) var composerStyle: ComposerStyle
    @Environment(\.theme) private var theme: Theme
    @Environment(\.style) private var style: Style

    @Binding private var text: String
    private var focused: Binding<Bool>
    private let placeholder: String
    private let imageAttachments: [PromptComposerImageAttachmentPreview]
    private let imageAttachmentErrorMessage: String?
    private let remainingImageSlots: Int
    private let isImageInputEnabled: Bool
    private let isSubmitDisabled: Bool
    private let isSubmitting: Bool
    private let onSubmit: () -> Void
    private let onRemoveImageAttachment: (UUID) -> Void
    private let onPhotosSelected: ([PhotosPickerItem]) -> Void
    private let onCameraImageCaptured: (UIImage) -> Void
    private let inlinePhotoPickerHeight: CGFloat = 350

    @State private var isInlinePhotoPickerVisible: Bool = false
    @State private var isPhotoSheetPresented: Bool = false
    @State private var isCameraPresented: Bool = false
    // Backing selection for both inline and sheet PhotosPicker variants.
    @State private var selectedPhotoItems: [PhotosPickerItem] = []

    init(
        text: Binding<String>,
        focused: Binding<Bool>,
        placeholder: String,
        imageAttachments: [PromptComposerImageAttachmentPreview] = [],
        imageAttachmentErrorMessage: String? = nil,
        remainingImageSlots: Int = 0,
        isImageInputEnabled: Bool = true,
        isSubmitDisabled: Bool,
        isSubmitting: Bool = false,
        onSubmit: @escaping () -> Void,
        onRemoveImageAttachment: @escaping (UUID) -> Void = { _ in },
        onPhotosSelected: @escaping ([PhotosPickerItem]) -> Void = { _ in },
        onCameraImageCaptured: @escaping (UIImage) -> Void = { _ in }
    ) {
        _text = text
        self.focused = focused
        self.placeholder = placeholder
        self.imageAttachments = imageAttachments
        self.imageAttachmentErrorMessage = imageAttachmentErrorMessage
        self.remainingImageSlots = remainingImageSlots
        self.isImageInputEnabled = isImageInputEnabled
        self.isSubmitDisabled = isSubmitDisabled
        self.isSubmitting = isSubmitting
        self.onSubmit = onSubmit
        self.onRemoveImageAttachment = onRemoveImageAttachment
        self.onPhotosSelected = onPhotosSelected
        self.onCameraImageCaptured = onCameraImageCaptured
    }

    var composerShape: some Shape {
        RoundedRectangle(cornerRadius: 24, style: .continuous)
    }

    @Namespace var id

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                centerContent
                bottomBar
                    .padding(8)
            }

            ZStack {
                inlinePhotoPickerContent
            }
            .frame(height: 350, alignment: .bottom)
            .frame(height: isInlinePhotoPickerVisible ? 350 : 50, alignment: .bottom)
            .opacity(isInlinePhotoPickerVisible ? 1 : 0)
            .zIndex(1)
        }
        .clipShape(composerShape)
        .contentShape(composerShape)
        .promptComposerGlassBackground(
            in: composerShape,
            fallbackColor: theme.secondaryBackgroundColor,
            interactive: !isInlinePhotoPickerVisible
        )
        .onTapGesture {
            guard !isInlinePhotoPickerVisible else { return }
            focused.wrappedValue = true
        }
        .animation(style.springAnimation, value: isInlinePhotoPickerVisible)
        .animation(style.springAnimation, value: imageAttachments)
        .animation(style.springAnimation, value: imageAttachmentErrorMessage)
        .photosPicker(
            isPresented: $isPhotoSheetPresented,
            selection: $selectedPhotoItems,
            maxSelectionCount: max(1, remainingImageSlots),
            selectionBehavior: .default,
            matching: .images,
            preferredItemEncoding: .current
        )
        .photosPickerStyle(.presentation)
        .fullScreenCover(isPresented: $isCameraPresented) {
            SystemCameraCaptureView { image in
                isCameraPresented = false
                onCameraImageCaptured(image)
            } onCancel: {
                isCameraPresented = false
            }
            .ignoresSafeArea()
        }
        .onChange(of: selectedPhotoItems) { _, newValue in
            handlePhotoSelection(newValue)
        }
    }

    private var centerContent: some View {
        VStack(spacing: style.gridSize) {
            if hasImageAttachmentPreviewContent {
                AttachmentPreviews(
                    attachments: imageAttachments,
                    errorMessage: imageAttachmentErrorMessage,
                    onRemove: onRemoveImageAttachment
                )
                .transition(.opacity.animation(.easeIn(duration: 0.1)))
            }

            Editor(
                text: $text,
                focused: focused,
                placeholder: placeholder
            )
            .transition(.opacity)
        }
    }

    private var inlinePhotoPickerContent: some View {
        ZStack(alignment: .bottom) {
            PhotosPicker(
                selection: $selectedPhotoItems,
                maxSelectionCount: max(1, remainingImageSlots),
                selectionBehavior: .continuous,
                matching: .images,
                preferredItemEncoding: .current
            ) {
                Color.clear
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle())
            }
            .photosPickerStyle(.inline)
            .photosPickerAccessoryVisibility(.hidden)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())

            inlinePhotoPickerControls
                .padding(8)
        }
    }

    private var inlinePhotoPickerControls: some View {
        HStack {
            Button {
                setInlinePhotoPickerVisible(!isInlinePhotoPickerVisible)
            } label: {
                xmarkIcon
                    .foregroundStyle(theme.labelColor)
                    .glassBackground(in: .circle)
            }
            .buttonBorderShape(.circle)

            Spacer()

            Button {
                isPhotoSheetPresented = true
            } label: {
                Label("Show All Photos", systemImage: "photo.stack")
                    .styledFont(.caption)
            }
            .glassButtonStyle()
        }
    }

    @ViewBuilder
    var bottomBar: some View {
        HStack(alignment: .bottom, spacing: style.gridSize) {
            if isImageInputEnabled {
                imageSourceControl
            }

            Spacer()

            SendButton(
                isSubmitDisabled: isSubmitDisabled,
                isSubmitting: isSubmitting,
                size: composerStyle.bottomButtonSize,
                onSubmit: onSubmit
            )
        }
    }

    var xmarkIcon: some View {
        Image(systemName: "xmark")
            .font(.system(size: 16, weight: .semibold))
            .frame(width: composerStyle.bottomButtonSize, height: composerStyle.bottomButtonSize)
    }

    private var imageSourceControl: some View {
        ZStack {
            Group {
                if isInlinePhotoPickerVisible {
                    Button {
                        setInlinePhotoPickerVisible(false)
                    } label: {
                        xmarkIcon
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.secondaryLabelColor)
                    .accessibilityLabel("Dismiss photo picker")
                } else {
                    ImageSourceMenu(
                        isDisabled: isSubmitting || remainingImageSlots <= 0,
                        onOpenCamera: openCamera,
                        onOpenPhotos: showInlinePhotoPicker
                    )
                }
            }
            .transition(.scale.combined(with: .opacity))
        }
        .frame(width: style.gridSize * 4, height: style.gridSize * 4)
        .animation(style.springAnimation, value: isInlinePhotoPickerVisible)
    }

    private func openCamera() {
        focused.wrappedValue = false
        isCameraPresented = true
    }

    private func showInlinePhotoPicker() {
        setInlinePhotoPickerVisible(true)
    }

    private func setInlinePhotoPickerVisible(_ isVisible: Bool) {
        withAnimation(style.springAnimation) {
            if isVisible {
                focused.wrappedValue = false
            }
            isInlinePhotoPickerVisible = isVisible
        }
    }

    private func handlePhotoSelection(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        selectedPhotoItems = []
        setInlinePhotoPickerVisible(false)
        onPhotosSelected(items)
    }

    private var hasImageAttachmentPreviewContent: Bool {
        !imageAttachments.isEmpty || !(imageAttachmentErrorMessage ?? "").isEmpty
    }
}

private extension PromptComposerView {
    struct InlinePhotoPickerReveal<Content: View>: View {
        let isVisible: Bool
        let height: CGFloat
        let animation: Animation
        let content: () -> Content

        @State private var isMounted = false
        @State private var isRevealed = false

        init(
            isVisible: Bool,
            height: CGFloat,
            animation: Animation,
            @ViewBuilder content: @escaping () -> Content
        ) {
            self.isVisible = isVisible
            self.height = height
            self.animation = animation
            self.content = content
        }

        var body: some View {
            ZStack(alignment: .bottom) {
                if isMounted {
                    content()
                        .frame(height: height, alignment: .bottom)
                        .transition(.identity)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: isRevealed ? height : 0, alignment: .bottom)
            .onAppear {
                updateVisibility(isVisible, animated: false)
            }
            .onChange(of: isVisible) { _, newValue in
                updateVisibility(newValue, animated: true)
            }
        }

        private func updateVisibility(_ shouldReveal: Bool, animated: Bool) {
            if shouldReveal {
                mountContent()
                setRevealed(true, animated: animated)
            } else {
                setRevealed(false, animated: animated) {
                    isMounted = false
                }
            }
        }

        private func mountContent() {
            guard !isMounted else { return }

            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                isMounted = true
            }
        }

        private func setRevealed(
            _ revealed: Bool,
            animated: Bool,
            completion: (() -> Void)? = nil
        ) {
            if animated {
                withAnimation(animation) {
                    isRevealed = revealed
                } completion: {
                    completion?()
                }
            } else {
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    isRevealed = revealed
                }
                completion?()
            }
        }
    }
}

private extension View {
    @ViewBuilder
    func promptComposerGlassBackground<S: Shape>(
        in shape: S,
        fallbackColor: Color,
        interactive: Bool = true,
        isGlassEnabled: Bool = true
    ) -> some View {
        if #available(iOS 26.0, *) {
            let effect: Glass = {
                var glass = isGlassEnabled ? Glass.regular : Glass.identity
                if isGlassEnabled, interactive {
                    glass = glass.interactive()
                }
                return glass
            }()
            glassEffect(effect, in: shape)
        } else {
            background(shape.fill(fallbackColor))
        }
    }
}
