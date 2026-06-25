//
//  UserMessageView.swift
//  CloudeCode
//
//  Created by Ben Edelstein on 6/14/26.
//
import Domain
import SwiftUI
import UIKit

struct UserMessageView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let message: SessionMessage

    private var images: [SessionImageInfo] {
        message.parts.enumerated().compactMap { index, part in
            guard case .file(let payload) = part,
                  payload.mediaType.hasPrefix("image/"),
                  let url = Self.resolveAttachmentURL(payload.url) else {
                return nil
            }

            return SessionImageInfo(
                id: "\(message.id)-image-\(index)",
                url: url,
                width: payload.width,
                height: payload.height,
                accessibilityLabel: payload.filename ?? "Uploaded image"
            )
        }
    }

    private var hasText: Bool {
        !message.text.isEmpty
    }

    var body: some View {
        HStack(alignment: .top) {
            Spacer(minLength: style.gridSize * 5)
            VStack(alignment: .trailing, spacing: style.gridSize / 2) {
                imageViews
                // future optimization - chunk this text if its long
                if hasText {
                    Text(verbatim: message.text)
                        .styledFont(.subheadline)
                        .foregroundStyle(theme.labelColor)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(userMessageShape.fill(theme.secondaryBackgroundColor))
                }
            }
        }
    }

    @ViewBuilder
    private var imageViews: some View {
        if !images.isEmpty {
            HStack(spacing: style.gridSize) {
                ForEach(images) { image in
                    userImageView(image)
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    private func userImageView(_ userImage: SessionImageInfo) -> some View {
        UserMessageRemoteImage(
            image: userImage,
            height: style.gridSize * 15
        )
    }

    private static func resolveAttachmentURL(_ rawURL: String) -> URL? {
        if let url = URL(string: rawURL), url.scheme != nil {
            return url.scheme == "blob" ? nil : url
        }

        guard rawURL.hasPrefix("/") else {
            return nil
        }

        guard let string = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
              let baseURL = URL(string: string),
              var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: true) else {
            return nil
        }

        components.path = rawURL
        return components.url
    }

    private var userMessageShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
    }
}

private struct UserMessageRemoteImage: View {
    @Environment(\.fetchImageAction) private var fetchImageAction
    @Environment(\.openAgentSessionImage) private var openImage
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let image: SessionImageInfo
    let height: CGFloat

    @State private var uiImage: UIImage?
    @State private var didFail = false

    var body: some View {
        content
            .task(id: image.url) {
                await loadImage()
            }
    }

    @ViewBuilder
    private var content: some View {
        if let uiImage {
            // todo add nuke image cache
            Button {
                openImage(image)
            } label: {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
                    .frame(width: displayWidth, height: height)
                    .clipShape(imageShape)
                    .overlay {
                        imageShape.stroke(theme.outlineColor, lineWidth: style.outlineThickness)
                    }
                    .contentShape(imageShape)
                    .accessibilityLabel(image.accessibilityLabel)
                    .accessibilityAddTraits(.isButton)
            }
        } else if didFail {
            imageFailureView
        } else {
            imagePlaceholder
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

    private var imageShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
    }

    private var imagePlaceholder: some View {
        ProgressView()
            .frame(width: reservedWidth, height: height)
            .background(imageShape.fill(theme.loadingBackgroundColor))
    }

    private var imageFailureView: some View {
        Image(systemName: "photo")
            .foregroundStyle(theme.secondaryLabelColor)
            .frame(width: reservedWidth, height: height)
            .background(imageShape.fill(theme.loadingBackgroundColor))
            .overlay {
                imageShape.stroke(theme.outlineColor, lineWidth: style.outlineThickness)
            }
            .accessibilityLabel(Text(verbatim: "Image failed to load"))
    }

    private var displayWidth: CGFloat? {
        image.displayWidth(for: height)
    }

    private var reservedWidth: CGFloat {
        displayWidth ?? height
    }
}
