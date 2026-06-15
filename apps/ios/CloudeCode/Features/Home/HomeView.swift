import Domain
import Entities
import Foundation
import SwiftUI

struct HomeView: View {
    @Environment(\.style) private var style
    @Environment(\.openSettings) private var openSettings
    @Environment(\.showToast) private var showToast
    @Environment(\.notificationRegistrationService) private var notificationRegistrationService

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
            content
                .navigationTitle("Sessions")
                .toolbar { settingsToolbar }
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
            async let notifications: Void = prepareNotifications()
            async let start: Void = viewModel.start()
            _ = await (notifications, start)
        }
        .onDisappear {
            viewModel.unload()
        }
    }

    private func prepareNotifications() async {
        guard let notificationRegistrationService else { return }
        await notificationRegistrationService.requestNotificationAuthorization()
    }

    @ViewBuilder
    private var content: some View {
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
            sessionsList
        }
    }

    private var sessionsList: some View {
        List(viewModel.groups) { group in
            Section(isExpanded: expandedBinding(for: group)) {
                ForEach(group.sessions) { session in
                    sessionLink(for: session)
                }
            } header: {
                RepoSectionHeader(group: group)
            }
        }
        .animation(.default, value: viewModel.groups)
        .listStyle(.automatic)
        .refreshable {
            await viewModel.refresh()
        }
    }

    private func sessionLink(for session: SessionSummaryModel) -> some View {
        NavigationLink(value: session) {
            SessionRow(session: session)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                sessionPendingDelete = session
            } label: {
                Label("", systemImage: "trash")
            }
            .accessibilityLabel("Delete")

            Button {
                Task {
                    await viewModel.archive(session)
                }
            } label: {
                Label("", systemImage: "archivebox")
            }
            .tint(.gray)
            .accessibilityLabel("Archive")
        }
    }

    @ToolbarContentBuilder
    private var settingsToolbar: some ToolbarContent {
        if let openSettings {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    openSettings()
                } label: {
                    Image(systemName: "person.crop.circle")
                }
                .accessibilityLabel("Settings")
            }
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
            Image(.folderGit2)
                .resizable()
                .renderingMode(.template)
                .aspectRatio(contentMode: .fit)
                .frame(width: 16, height: 16)

            Text(group.repoFullName)
                .styledFont(.subheadline)
                .lineLimit(1)

            Spacer()

            Text(group.sessions.count.formatted())
                .styledFont(.caption)
                .foregroundStyle(theme.tertiaryLabelColor)
        }
        .foregroundStyle(theme.secondaryLabelColor)
        .textCase(nil)
    }
}

private struct SessionRow: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let session: SessionSummaryModel

    var body: some View {
        HStack(alignment: .center, spacing: style.gridSize * 1.5) {
            SessionArtifactIcon(session: session)
                .frame(width: style.gridSize * 2.5, height: style.gridSize * 2.5)

            VStack(alignment: .leading) {
                Text(session.title ?? "Untitled session")
                    .styledFont(.headline)
                    .foregroundStyle(theme.labelColor)
                    .lineLimit(1)

                if let pushedBranch = session.pushedBranch {
                    Text(pushedBranch)
                        .styledFont(.caption)
                        .foregroundStyle(theme.secondaryLabelColor)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Spacer(minLength: style.gridSize)

            SessionAttentionSlot(session: session)
        }
        .border(.red)
    }
}

private struct SessionArtifactIcon: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let session: SessionSummaryModel

    var body: some View {
        if let icon = artifactIcon {
            Image(icon.0)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .foregroundStyle(icon.1)
        } else {
            Color.clear
        }
    }

    private var artifactIcon: (ImageResource, Color)? {
        if let pullRequest = session.pullRequest {
            return icon(for: pullRequest)
        }

        if session.pushedBranch != nil {
            return (.gitBranch, theme.secondaryLabelColor)
        }

        return nil
    }

    private func icon(for pullRequest: Domain.SessionSummary.PullRequest) -> (ImageResource, Color) {
        switch pullRequest.state {
        case "merged":
            return (.gitMerge, .purple)
        case "closed":
            return (.gitPullRequestClosed, theme.errorRed)
        default:
            return (.gitPullRequest, .green)
        }
    }
}

private struct ArtifactIcon {
    let systemName: String
    let color: Color
    let accessibilityLabel: String
}

private struct SessionAttentionSlot: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let session: SessionSummaryModel

    var body: some View {
        if session.workingState == "responding" {
            ProgressView()
                .controlSize(.small)
                .tint(theme.secondaryLabelColor)
                .accessibilityLabel("Responding")
        } else if session.hasUnread {
            Circle()
                .fill(theme.accentBlue)
                .frame(width: style.gridSize, height: style.gridSize)
                .accessibilityLabel("Unread message")
        } else {
            Text(SessionTimestampFormatter.relativeString(for: session.activityTimestamp))
                .styledFont(.caption)
                .foregroundStyle(theme.secondaryLabelColor)
                .lineLimit(1)
        }
    }
}

private enum SessionTimestampFormatter {
    private static let fractionalISOFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoFormatter = ISO8601DateFormatter()

    static func relativeString(for timestamp: String, relativeTo now: Date = Date()) -> String {
        guard let date = fractionalISOFormatter.date(from: timestamp) ?? isoFormatter.date(from: timestamp) else {
            return ""
        }

        let second: TimeInterval = 1
        let minute = 60 * second
        let hour = 60 * minute
        let day = 24 * hour
        let week = 7 * day
        let month = 30 * day
        let elapsed = max(0, now.timeIntervalSince(date))

        if elapsed < minute {
            let seconds = Int(elapsed / second)
            return seconds == 0 ? "NOW" : "\(seconds)s"
        }
        if elapsed < hour {
            return "\(Int(elapsed / minute))m"
        }
        if elapsed < day {
            return "\(Int(elapsed / hour))h"
        }
        if elapsed < week {
            return "\(Int(elapsed / day))d"
        }
        if elapsed < month {
            return "\(Int(elapsed / week))w"
        }
        return "\(Int(elapsed / month))mo"
    }
}

private extension SessionSummaryModel {
    var activityTimestamp: String {
        lastMessageAt ?? updatedAt
    }
}
