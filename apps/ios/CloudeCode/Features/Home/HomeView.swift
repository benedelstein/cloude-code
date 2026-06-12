import Domain
import Entities
import Foundation
import SwiftUI

struct HomeView: View {
    @Environment(\.style) private var style
    @Environment(\.showToast) private var showToast

    @State private var viewModel: HomeViewModel
    @State private var collapsedRepoIDs = Set<Int>()
    @State private var sessionPendingDelete: SessionSummaryModel?
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
                        Section(isExpanded: expandedBinding(for: group)) {
                            ForEach(group.sessions) { session in
                                NavigationLink(value: session) {
                                    SessionRow(session: session)
                                }
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    Button(role: .destructive) {
                                        sessionPendingDelete = session
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }

                                    Button {
                                        Task {
                                            await viewModel.archive(session)
                                        }
                                    } label: {
                                        Label("Archive", systemImage: "archivebox")
                                    }
                                    .tint(.gray)
                                }
                            }
                        } header: {
                            RepoSectionHeader(group: group)
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
            .alert(
                "Delete session?",
                isPresented: deleteConfirmationPresented,
                presenting: sessionPendingDelete
            ) { session in
                Button("Delete", role: .destructive) {
                    Task {
                        await viewModel.delete(session)
                    }
                }
                Button("Cancel", role: .cancel) {
                    sessionPendingDelete = nil
                }
            } message: { session in
                Text("This permanently deletes \(session.title ?? "this session").")
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

    private func expandedBinding(for group: HomeSessionGroup) -> Binding<Bool> {
        Binding {
            !collapsedRepoIDs.contains(group.id)
        } set: { isExpanded in
            if isExpanded {
                collapsedRepoIDs.remove(group.id)
            } else {
                collapsedRepoIDs.insert(group.id)
            }
        }
    }

    private var deleteConfirmationPresented: Binding<Bool> {
        Binding {
            sessionPendingDelete != nil
        } set: { isPresented in
            if !isPresented {
                sessionPendingDelete = nil
            }
        }
    }
}

private struct RepoSectionHeader: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let group: HomeSessionGroup

    var body: some View {
        HStack(spacing: style.gridSize) {
            Image(systemName: "folder.badge.gearshape")
                .foregroundStyle(theme.secondaryLabelColor)

            Text(group.repoFullName)
                .styledFont(.subheadline)
                .foregroundStyle(theme.secondaryLabelColor)
                .lineLimit(1)

            Spacer()

            Text(group.sessions.count.formatted())
                .styledFont(.caption)
                .foregroundStyle(theme.secondaryLabelColor)
        }
        .textCase(nil)
    }
}

private struct SessionRow: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let session: SessionSummaryModel

    var body: some View {
        HStack(alignment: .center, spacing: style.spacing) {
            VStack(alignment: .leading, spacing: style.gridSize) {
                Text(session.title ?? "Untitled session")
                    .styledFont(.headline)
                    .foregroundStyle(theme.labelColor)
                    .lineLimit(2)

                HStack(spacing: style.gridSize) {
                    BranchMetadata(session: session)

                    if let pullRequest = session.pullRequest {
                        PullRequestMetadata(pullRequest: pullRequest)
                    }
                }
                .lineLimit(1)
            }

            Spacer(minLength: style.gridSize)

            VStack(alignment: .trailing, spacing: style.gridSize) {
                HStack(spacing: style.gridSize) {
                    if session.hasUnread {
                        Circle()
                            .fill(theme.accentBlue)
                            .frame(width: style.gridSize, height: style.gridSize)
                    }

                    Text(session.workingState)
                        .styledFont(.caption)
                        .foregroundStyle(theme.secondaryLabelColor)
                }

                Text(SessionTimestampFormatter.relativeString(for: session.activityTimestamp))
                    .styledFont(.caption)
                    .foregroundStyle(theme.secondaryLabelColor)
            }
        }
        .padding(.vertical, style.gridSize * 1.5)
    }
}

private struct BranchMetadata: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let session: SessionSummaryModel

    var body: some View {
        HStack(spacing: style.gridSize / 2) {
            Image(systemName: "arrow.triangle.branch")
                .foregroundStyle(theme.moneyGreen)

            Text(session.pushedBranch ?? "No branch")
                .styledFont(.caption)
                .foregroundStyle(theme.secondaryLabelColor)
        }
    }
}

private struct PullRequestMetadata: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let pullRequest: Domain.SessionSummary.PullRequest

    var body: some View {
        HStack(spacing: style.gridSize / 2) {
            Image(systemName: "arrow.triangle.pull")
                .foregroundStyle(theme.accentBlue)

            Text("#\(pullRequest.number) \(pullRequest.state)")
                .styledFont(.caption)
                .foregroundStyle(theme.secondaryLabelColor)
        }
    }
}

private enum SessionTimestampFormatter {
    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter
    }()

    private static let fractionalISOFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoFormatter = ISO8601DateFormatter()

    static func relativeString(for timestamp: String) -> String {
        guard let date = fractionalISOFormatter.date(from: timestamp) ?? isoFormatter.date(from: timestamp) else {
            return ""
        }
        return relativeFormatter.localizedString(for: date, relativeTo: Date())
    }
}

private extension SessionSummaryModel {
    var activityTimestamp: String {
        lastMessageAt ?? updatedAt
    }
}
