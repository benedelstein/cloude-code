import SwiftUI

struct ToastContainerView<Content: View>: View {
    @Environment(\.style) private var style
    @Environment(\.theme) private var theme

    let content: () -> Content

    private let cornerRadius: CGFloat = 22
    private let verticalInset: CGFloat = 14
    private let horizontalInset: CGFloat = 18

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        content()
            .frame(maxWidth: .infinity)
            .padding(.horizontal, horizontalInset)
            .padding(.vertical, verticalInset)
            .toastGlassBackground(in: shape)
            .overlay {
                shape
                    .stroke(Color.white.opacity(0.5), lineWidth: 0.5)
            }
            .padding(.horizontal, style.horizontalPadding)
    }
}

struct ToastDefaultContentView: View {
    @Environment(\.style) private var style
    @Environment(\.theme) private var theme

    let title: Text
    var subtitle: Text?
    var icon: Image?

    var body: some View {
        HStack(spacing: 12) {
            if let icon {
                icon
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(theme.accentBlue)
            }

            VStack(alignment: icon == nil ? .center : .leading, spacing: 4) {
                title
                    .font(style.calloutFont.weight(.bold))
                    .foregroundStyle(theme.labelColor)

                if let subtitle {
                    subtitle
                        .font(style.footnoteFont)
                        .foregroundStyle(theme.secondaryLabelColor)
                        .multilineTextAlignment(icon == nil ? .center : .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: icon == nil ? .center : .leading)
        }
    }
}

struct ToastSceneView: View {
    @Environment(\.style) private var style

    let controller: ToastWindowController

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: alignment(for: controller.presentation?.config.position ?? .top)) {
                Color.clear

                if let presentation = controller.presentation {
                    presentation.content
                        .padding(.top, geometry.safeAreaInsets.top + style.spacing)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .id(presentation.id)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .allowsHitTesting(false)
    }

    private func alignment(for position: ToastPosition) -> Alignment {
        switch position {
        case .top:
            return .top
        }
    }
}

private extension View {
    @ViewBuilder
    func toastGlassBackground<S: Shape>(in shape: S) -> some View {
        if #available(iOS 26.0, *) {
            glassEffect(.regular, in: shape)
        } else {
            background(
                shape
                    .fill(.ultraThinMaterial)
                    .shadow(color: Color.black.opacity(0.2), radius: 8)
            )
        }
    }
}
