import SwiftUI

struct RepoBranchPickerBar: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let draft: NewSessionDraft
    @State private var isRepositorySheetPresented = false
    @State private var isBranchSheetPresented = false

    var body: some View {
        HStack(spacing: style.gridSize) {
            repositoryButton

            if let selectedRepo = draft.selectedRepo {
                branchButton(for: selectedRepo)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
        .sheet(isPresented: $isRepositorySheetPresented) {
            RepoPickerSheet(draft: draft)
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $isBranchSheetPresented) {
            if let selectedRepo = draft.selectedRepo {
                BranchPickerSheet(draft: draft, selectedRepo: selectedRepo)
                    .presentationDetents([.medium, .large])
            }
        }
    }

    private var repositoryButton: some View {
        Button {
            isRepositorySheetPresented = true
        } label: {
            HStack(spacing: style.gridSize) {
                Image(.folderGit2)
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .frame(width: 16, height: 16)

                Text(draft.selectedRepo?.fullName ?? "Repository")
                    .styledFont(.caption)
                    .foregroundStyle(theme.labelColor)
                    .lineLimit(1)
                    .frame(maxWidth: 132, alignment: .leading)
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .contentShape(Capsule())
            .glassBackground(in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Select repository")
    }

    private func branchButton(for selectedRepo: NewSessionDraft.SelectedRepo) -> some View {
        Button {
            isBranchSheetPresented = true
        } label: {
            HStack(spacing: style.gridSize) {
                Image(.gitBranch)
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .frame(width: 16, height: 16)

                Text(draft.selectedBranch ?? selectedRepo.defaultBranch)
                    .styledFont(.caption)
                    .foregroundStyle(theme.labelColor)
                    .lineLimit(1)
                    .frame(maxWidth: 100, alignment: .leading)
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .contentShape(Capsule())
            .glassBackground(in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Select base branch")
    }
}
