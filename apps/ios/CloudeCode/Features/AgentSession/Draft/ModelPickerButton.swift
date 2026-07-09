import SwiftUI

struct ModelPickerButton: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let draft: NewSessionDraft
    @State private var isSheetPresented = false

    var body: some View {
        Button {
            isSheetPresented = true
        } label: {
            HStack(spacing: style.gridSize * 0.75) {
                if let model = draft.selectedModel {
                    ProviderIconView(providerId: model.providerId)
                        .frame(width: 16, height: 16)
                    Text(model.displayName)
                        .lineLimit(1)
                } else {
                    Image(systemName: "cpu")
                    Text("Select model")
                        .lineLimit(1)
                }
            }
            .styledFont(.caption)
            .foregroundStyle(theme.labelColor)
            .padding(.horizontal, 12)
            .frame(height: 36)
            .contentShape(Capsule())
            .glassBackground(in: Capsule())
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $isSheetPresented) {
            ModelPickerSheet(draft: draft)
                .presentationDetents([.medium])
        }
    }
}
