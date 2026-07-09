import CoreAPI
import SwiftUI

struct RepoBranchPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme

    let draft: NewSessionDraft
    @State private var query = ""
    @State private var visibleRepos: [Repo] = []
    @State private var selectedRepo: Repo?
    @State private var branches: [Branch] = []
    @State private var selectedBranch: String?
    @State private var searchTask: Task<Void, Never>?
    @State private var isLoadingBranches = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let selectedRepo {
                    branchList(for: selectedRepo)
                } else {
                    repoList
                }
            }
            .scrollContentBackground(.hidden)
            .background(theme.secondaryBackgroundColor)
            .navigationTitle(selectedRepo == nil ? "Repository" : "Branch")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
            .toolbar { toolbar }
            .onAppear(perform: loadInitialRepos)
            .onChange(of: query) { _, newValue in
                scheduleSearch(newValue)
            }
            .onDisappear {
                searchTask?.cancel()
            }
        }
    }

    @ViewBuilder
    private var repoList: some View {
        if let errorMessage {
            ContentUnavailableView(
                "Repository unavailable",
                systemImage: "exclamationmark.triangle",
                description: Text(errorMessage)
            )
        } else if visibleRepos.isEmpty && draft.isLoadingRepos {
            ProgressView()
                .frame(maxWidth: .infinity, alignment: .center)
        } else {
            ForEach(visibleRepos, id: \.id) { repo in
                Button {
                    selectRepoForBranchPick(repo)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(repo.fullName)
                            .foregroundStyle(theme.labelColor)
                            .lineLimit(1)
                        Text(repo.defaultBranch)
                            .font(.caption)
                            .foregroundStyle(theme.secondaryLabelColor)
                            .lineLimit(1)
                    }
                }
            }
        }
    }

    private func branchList(for repo: Repo) -> some View {
        Group {
            if isLoadingBranches {
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .center)
            } else {
                ForEach(branches.map(\.name), id: \.self) { branchName in
                    Button {
                        selectedBranch = branchName
                    } label: {
                        HStack {
                            Text(branchName)
                                .foregroundStyle(theme.labelColor)
                            Spacer()
                            if selectedBranch == branchName {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(theme.accentBlue)
                            }
                        }
                    }
                }

                if branches.isEmpty {
                    Text(repo.defaultBranch)
                        .foregroundStyle(theme.labelColor)
                }
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if selectedRepo != nil {
            ToolbarItem(placement: .topBarLeading) {
                Button("Repos") {
                    selectedRepo = nil
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") {
                    confirmSelection()
                }
            }
        } else {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Cancel") {
                    dismiss()
                }
            }
        }
    }

    private func loadInitialRepos() {
        visibleRepos = draft.repos
    }

    private func scheduleSearch(_ query: String) {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else {
                return
            }
            do {
                let repos = try await draft.searchRepos(query: query)
                guard !Task.isCancelled else {
                    return
                }
                visibleRepos = repos
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func selectRepoForBranchPick(_ repo: Repo) {
        selectedRepo = repo
        selectedBranch = repo.defaultBranch
        isLoadingBranches = true
        Task {
            do {
                branches = try await draft.branches(for: repo)
                selectedBranch = branches.first(where: \.isDefault)?.name ?? repo.defaultBranch
                errorMessage = nil
            } catch {
                branches = [Branch(name: repo.defaultBranch, isDefault: true)]
                errorMessage = error.localizedDescription
            }
            isLoadingBranches = false
        }
    }

    private func confirmSelection() {
        guard let selectedRepo else {
            return
        }
        draft.selectRepo(selectedRepo, branch: selectedBranch)
        // swiftlint:disable:next todo
        // TODO: edit/plan mode toggle
        dismiss()
    }
}
