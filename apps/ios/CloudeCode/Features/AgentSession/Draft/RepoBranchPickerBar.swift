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
            pickerLabel(
                icon: .folderGit2,
                title: draft.selectedRepo?.fullName ?? "Repository",
                maxTitleWidth: 132
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Select repository")
    }

    private func branchButton(for selectedRepo: NewSessionDraft.SelectedRepo) -> some View {
        Button {
            isBranchSheetPresented = true
        } label: {
            pickerLabel(
                icon: .gitBranch,
                title: draft.selectedBranch ?? selectedRepo.defaultBranch,
                maxTitleWidth: 100
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Select base branch")
    }

    private func pickerLabel(
        icon: ImageResource,
        title: String,
        maxTitleWidth: CGFloat
    ) -> some View {
        HStack(spacing: style.gridSize) {
            Image(icon)
                .resizable()
                .renderingMode(.template)
                .scaledToFit()
                .frame(width: 16, height: 16)

            Text(title)
                .styledFont(.caption)
                .foregroundStyle(theme.labelColor)
                .lineLimit(1)
                .frame(maxWidth: maxTitleWidth, alignment: .leading)
        }
        .padding(.horizontal, 12)
        .frame(height: 36)
        .contentShape(Capsule())
        .glassBackground(in: Capsule())
    }
}
