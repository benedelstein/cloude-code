import SwiftUI

struct SessionTranscriptScrollToBottomOverlay: View {
    @Environment(\.safeAreaInsets) private var safeAreaInsets

    let isVisible: Bool
    let bottomObstructionHeight: CGFloat
    let action: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            if isVisible {
                SessionTranscriptScrollToBottomButton(action: action)
            }

            Color.clear
                .frame(height: bottomObstructionHeight + safeAreaInsets.bottom + 16)
                .allowsHitTesting(false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct SessionTranscriptScrollToBottomButton: View {
    @Environment(\.theme) private var theme: Theme

    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.down")
                .font(.body(16))
                .foregroundStyle(theme.labelColor)
                .frame(width: 40, height: 40)
                .glassBackground(in: Circle(), interactive: true)
        }
        .buttonStyle(.plain)
        .contentShape(Circle())
        .transition(.scale(scale: 0.5).combined(with: .opacity).animation(.spring))
    }
}
