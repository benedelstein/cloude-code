import SwiftUI

struct SessionView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    @State private var store: SessionFeatureStore

    init(store: SessionFeatureStore) {
        _store = State(initialValue: store)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: style.spacing) {
            Text(store.title)
                .styledFont(.title2)
                .foregroundStyle(theme.labelColor)

            HStack(spacing: style.gridSize) {
                Text(store.repository)
                Text("-")
                Text(store.status)
            }
            .styledFont(.subheadline)
            .foregroundStyle(theme.secondaryLabelColor)

            Divider()

            ContentUnavailableView(
                "Session",
                systemImage: "text.bubble",
                description: Text("Session detail scaffold")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding()
        .navigationTitle("Session")
        .navigationBarTitleDisplayMode(.inline)
    }
}
