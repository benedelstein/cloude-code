import SwiftUI

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
