import Entities
import SwiftUI

struct HomeView: View {
    @Environment(\.style) private var style
    @Environment(\.showToast) private var showToast

    @State private var viewModel: HomeViewModel
    let sessionBuilder: AgentSessionBuilder

    init(viewModel: HomeViewModel, sessionBuilder: AgentSessionBuilder) {
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
                    .refreshable {
                        await viewModel.refresh()
                    }
                }
            }
            .navigationTitle("Cloude Code")
            .navigationDestination(for: SessionSummaryModel.self) { session in
                sessionBuilder.build(session: session)
            }
            .onChange(of: viewModel.errorMessage) { _, errorMessage in
                guard let errorMessage else {
                    return
                }
                showToast?(
                    verbatimTitle: errorMessage,
                    icon: Image(systemName: "exclamationmark.circle.fill")
                )
            }
        }
        // Outside the NavigationStack: pushes/pops re-evaluate the stack's
        // content, and we only want to bind once per appearance of Home.
        .task {
            await viewModel.start()
        }
        .onDisappear {
            viewModel.unload()
        }
    }
}

private struct SessionRow: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let session: SessionSummaryModel

    var body: some View {
        VStack(alignment: .leading, spacing: style.gridSize) {
            HStack(spacing: style.gridSize) {
                Text(session.title ?? "Untitled session")
                    .styledFont(.headline)
                    .foregroundStyle(theme.labelColor)
                    .lineLimit(1)

                if session.hasUnread {
                    Circle()
                        .fill(theme.accentBlue)
                        .frame(width: style.gridSize, height: style.gridSize)
                }
            }

            HStack(spacing: style.gridSize) {
                Text(session.repoFullName)
                Text("-")
                Text(session.workingState)
            }
            .styledFont(.caption)
            .foregroundStyle(theme.secondaryLabelColor)
            .lineLimit(1)
        }
        .padding(.vertical, style.gridSize)
    }
}
