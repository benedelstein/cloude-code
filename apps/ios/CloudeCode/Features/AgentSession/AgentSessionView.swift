import Entities
import SwiftUI

struct AgentSessionView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    @State private var store: AgentSessionStore

    init(store: AgentSessionStore) {
        _store = State(initialValue: store)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: style.spacing) {
            Text(store.session.title ?? "Untitled session")
                .styledFont(.title2)
                .foregroundStyle(theme.labelColor)

            HStack(spacing: style.gridSize) {
                Text(store.session.repoFullName)
                Text("-")
                Text(store.session.workingState)
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
