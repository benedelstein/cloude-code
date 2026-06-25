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

struct OpenAgentSessionImageAction {
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
    @State private var dismissDragOffset: CGFloat = 0

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.opacity(backgroundOpacity)
                .ignoresSafeArea()

            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .offset(y: dismissDragOffset)

            HStack {
                CloseButton {
                    dismiss()
                }
                Spacer()
                Button {
                    // TODO: SAVE THE IMAGE
                } label: {
                    Image(systemName: "square.and.arrow.down")
                }
                .glassButtonStyle(.glass, tint: nil)
                .buttonBorderShape(.circle)
            }
            .padding()
        }
        .task(id: image.url) {
            await loadImage()
        }
        .presentationBackground(.clear)
        .background(Color.clear)
        .simultaneousGesture(dismissDragGesture)
        .statusBarHidden(true)
    }

    @ViewBuilder
    private var content: some View {
        if let uiImage {
            ZoomableImageView(
                image: uiImage,
                accessibilityLabel: image.accessibilityLabel
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
        let progress = min(max(dismissDragOffset, 0) / backgroundFadeDistance, 1)
        return Double(1 - (progress * 0.65))
    }

    private var dismissDragGesture: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                guard isDismissDrag(value) else {
                    return
                }
                dismissDragOffset = max(value.translation.height, 0)
            }
            .onEnded { value in
                guard isDismissDrag(value), value.translation.height > dismissDragThreshold else {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
                        dismissDragOffset = 0
                    }
                    return
                }

                dismiss()
            }
    }

    private func isDismissDrag(_ value: DragGesture.Value) -> Bool {
        value.translation.height > 0 && value.translation.height > abs(value.translation.width)
    }
}
