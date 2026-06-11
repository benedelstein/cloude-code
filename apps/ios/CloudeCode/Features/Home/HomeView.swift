import SwiftUI

struct HomeView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    @State private var viewModel: HomeViewModel
    let sessionBuilder: SessionBuilder

    init(viewModel: HomeViewModel, sessionBuilder: SessionBuilder) {
        _viewModel = State(initialValue: viewModel)
        self.sessionBuilder = sessionBuilder
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.isEmpty {
                    ContentUnavailableView(
                        "No sessions",
                        systemImage: "sidebar.left",
                        description: Text("Create a session to see it here.")
                    )
                } else {
                    List(viewModel.groups) { group in
                        Section(group.repoFullName) {
                            ForEach(group.sessions) { session in
                                NavigationLink(value: session) {
                                    SessionRow(session: session)
                                }
                            }
                        }
                    }
                    .listStyle(.sidebar)
                }
            }
            .navigationTitle("Cloude Code")
            .navigationDestination(for: HomeSessionRow.self) { session in
                sessionBuilder.build(session: session)
            }
            .overlay(alignment: .bottom) {
                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .styledFont(.footnote)
                        .foregroundStyle(theme.errorRed)
                        .padding()
                }
            }
            .task {
                await viewModel.start()
            }
        }
    }
}

private struct SessionRow: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let session: HomeSessionRow

    var body: some View {
        VStack(alignment: .leading, spacing: style.gridSize) {
            HStack(spacing: style.gridSize) {
                Text(session.title)
                    .styledFont(.headline)
                    .foregroundStyle(theme.labelColor)
                    .lineLimit(1)

                if session.hasUnread {
                    Circle()
                        .fill(theme.accentBlue)
                        .frame(width: style.gridSize * 2, height: style.gridSize * 2)
                }
            }

            HStack(spacing: style.gridSize) {
                Text(session.repository)
                Text("-")
                Text(session.status)
            }
            .styledFont(.caption)
            .foregroundStyle(theme.secondaryLabelColor)
            .lineLimit(1)
        }
        .padding(.vertical, style.gridSize)
    }
}
