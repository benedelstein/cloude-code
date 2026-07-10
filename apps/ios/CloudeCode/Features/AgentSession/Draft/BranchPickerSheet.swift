import CoreAPI
import SwiftUI

struct BranchPickerSheet: View {
    @Environment(\.style) var style: Style
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme

    let draft: NewSessionDraft
    let selectedRepo: NewSessionDraft.SelectedRepo
    @State private var query = ""
    @State private var branches: [Branch] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    init(draft: NewSessionDraft, selectedRepo: NewSessionDraft.SelectedRepo) {
        self.draft = draft
        self.selectedRepo = selectedRepo

        let cachedBranches = draft.cachedBranches(repoId: selectedRepo.id)
        _branches = State(initialValue: cachedBranches ?? [])
        _isLoading = State(initialValue: cachedBranches == nil)
    }

    var body: some View {
        NavigationStack {
            List {
                if isLoading {
                    defaultBranchRow
                    loadingRows
                        .transition(style.fadeTransition)
                } else {
                    if let errorMessage {
                        Text(errorMessage)
                            .foregroundStyle(theme.secondaryLabelColor)
                    }

                    if showsDefaultBranch {
                        defaultBranchRow
                    }

                    if !showsDefaultBranch && filteredBranchNames.isEmpty {
                        EmptyStateView(
                            title: "No branches found",
                            subtitle: "Try a different search."
                        ) {
                            Image(systemName: "arrow.triangle.branch")
                        }
                        .transition(style.fadeTransition)
                    }

                    ForEach(filteredBranchNames, id: \.self) { branchName in
                        BranchRow(
                            name: branchName,
                            isSelected: branchName == draft.selectedBranch
                        ) {
                            draft.selectBranch(branchName)
                            dismiss()
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .contentMargins(.top, 0, for: .scrollContent)
            .navigationTitle("Select Base Branch")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .automatic)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .task {
                guard isLoading else {
                    return
                }
                await loadBranches()
            }
        }
    }

    private var loadingRows: some View {
        ForEach(0 ..< 5, id: \.self) { _ in
            BranchRow(
                name: "feature/branch-name",
                isSelected: false,
                isEnabled: false
            ) {}
            .redacted(reason: .placeholder)
        }
    }

    private var defaultBranchRow: some View {
        BranchRow(
            name: selectedRepo.defaultBranch,
            isSelected: selectedRepo.defaultBranch == draft.selectedBranch
        ) {
            draft.selectBranch(selectedRepo.defaultBranch)
            dismiss()
        }
    }

    private var nonDefaultBranchNames: [String] {
        branches.compactMap { branch in
            branch.name == selectedRepo.defaultBranch ? nil : branch.name
        }
    }

    private var filteredBranchNames: [String] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else {
            return nonDefaultBranchNames
        }

        return nonDefaultBranchNames.filter {
            $0.localizedCaseInsensitiveContains(trimmedQuery)
        }
    }

    private var showsDefaultBranch: Bool {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedQuery.isEmpty
            || selectedRepo.defaultBranch.localizedCaseInsensitiveContains(trimmedQuery)
    }

    private func loadBranches() async {
        do {
            branches = try await draft.branches(repoId: selectedRepo.id)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private struct BranchRow: View {
        @Environment(\.theme) private var theme

        let name: String
        let isSelected: Bool
        let isEnabled: Bool
        let onSelect: () -> Void

        init(
            name: String,
            isSelected: Bool,
            isEnabled: Bool = true,
            onSelect: @escaping () -> Void
        ) {
            self.name = name
            self.isSelected = isSelected
            self.isEnabled = isEnabled
            self.onSelect = onSelect
        }

        var body: some View {
            Button(action: onSelect) {
                HStack {
                    Text(name)
                        .foregroundStyle(theme.labelColor)
                    Spacer()
                    if isSelected {
                        Image(systemName: "checkmark")
                            .foregroundStyle(theme.accentBlue)
                    }
                }
            }
            .disabled(!isEnabled)
        }
    }
}
