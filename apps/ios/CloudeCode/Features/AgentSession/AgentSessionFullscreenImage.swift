import SwiftUI
import UIKit

struct SessionImageInfo: Identifiable, Equatable {
    let id: String
    let url: URL
    let width: Int?
    let height: Int?
    let accessibilityLabel: String

    func displayWidth(for displayHeight: CGFloat) -> CGFloat? {
        guard let width, let height, width > 0, height > 0 else {
            return nil
        }

        return displayHeight * CGFloat(width) / CGFloat(height)
    }
}

struct OpenAgentSessionImageAction: Equatable {
    static func == (lhs: OpenAgentSessionImageAction, rhs: OpenAgentSessionImageAction) -> Bool {
        true
    }

    private let action: (SessionImageInfo) -> Void

    init(action: @escaping (SessionImageInfo) -> Void = { _ in }) {
        self.action = action
    }

    func callAsFunction(_ image: SessionImageInfo) {
        action(image)
    }
}

extension EnvironmentValues {
    @Entry
    var openAgentSessionImage: OpenAgentSessionImageAction = .init()
}

struct AgentSessionFullscreenImageView: View {
    private let dismissDragThreshold: CGFloat = 140
    private let backgroundFadeDistance: CGFloat = 280

    @Environment(\.dismiss) private var dismiss: DismissAction
    @Environment(\.fetchImageAction) private var fetchImageAction

    let image: SessionImageInfo

    @State private var uiImage: UIImage?
    @State private var didFail = false
    @State private var dismissDragOffset: CGSize = .zero
    @State private var isCompletingDragDismissal = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.opacity(backgroundOpacity)
                .ignoresSafeArea()

            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .offset(dismissDragOffset)

            HStack {
                CloseButton {
                    dismiss()
                }
                Spacer()

                GlassButton(
                    systemImage: "square.and.arrow.up",
                    isDisabled: uiImage == nil
                ) {
                    if let uiImage {
                        presentShareSheet(activityItems: [uiImage])
                    }
                }
                .accessibilityLabel("Share image")
            }
            .padding()
            .opacity(isCompletingDragDismissal ? 0 : 1)
            .allowsHitTesting(!isCompletingDragDismissal)
        }
        .task(id: image.url) {
            await loadImage()
        }
        .presentationBackground(.clear)
        .background(Color.clear)
        .statusBarHidden(true)
    }

    @ViewBuilder
    private var content: some View {
        if let uiImage {
            ZoomableImageView(
                image: uiImage,
                accessibilityLabel: image.accessibilityLabel,
                dragConfiguration: ZoomableImageDragConfiguration(
                    onChanged: handleDragChanged,
                    onEnded: handleDragEnded,
                    onCancelled: resetDismissDrag
                )
            )
                .accessibilityLabel(image.accessibilityLabel)
        } else if didFail {
            ContentUnavailableView("Image failed to load", systemImage: "photo")
                .foregroundStyle(.white)
        } else {
            ProgressView()
                .tint(.white)
        }
    }

    private func loadImage() async {
        didFail = false
        uiImage = nil

        do {
            let data = try await fetchImageAction(image.url)
            guard let loadedImage = UIImage(data: data) else {
                didFail = true
                return
            }
            uiImage = loadedImage
        } catch {
            didFail = true
        }
    }

    private var backgroundOpacity: Double {
        guard !isCompletingDragDismissal else {
            return 0
        }

        let progress = min(max(dismissDragOffset.height, 0) / backgroundFadeDistance, 1)
        return Double(1 - (progress * 0.65))
    }

    private func handleDragChanged(_ translation: CGSize) {
        guard !isCompletingDragDismissal else {
            return
        }

        dismissDragOffset = translation
    }

    private func handleDragEnded(_ translation: CGSize) {
        guard translation.height > dismissDragThreshold else {
            resetDismissDrag()
            return
        }

        withAnimation(.easeOut(duration: 0.12)) {
            dismissDragOffset = translation
            isCompletingDragDismissal = true
        }

        Task {
            try? await Task.sleep(nanoseconds: 120_000_000)
            await MainActor.run {
                dismiss()
            }
        }
    }

    private func resetDismissDrag() {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
            dismissDragOffset = .zero
            isCompletingDragDismissal = false
        }
    }
}
