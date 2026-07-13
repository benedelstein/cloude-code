import SwiftUI

/// Chip + menu for choosing the repo environment a new session is set up
/// with. Environment creation is not native yet; the menu's create action
/// kicks out to the web app.
struct EnvironmentPickerButton: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    let draft: NewSessionDraft

    /// True until environments have been served from cache or network.
    private var isLoading: Bool {
        draft.environments == nil
    }

    var body: some View {
        Menu {
            if let environments = draft.environments, !environments.isEmpty {
                ForEach(environments) { environment in
                    Button {
                        draft.selectEnvironment(environment.id)
                    } label: {
                        if draft.selectedEnvironmentId == environment.id {
                            Label(environment.name, systemImage: "checkmark")
                        } else {
                            Text(environment.name)
                        }
                    }
                }
            }

            Section {
                Button {
                    if let url = draft.createEnvironmentURL {
                        openURL(url)
                    }
                } label: {
                    Label("Create environment", systemImage: "plus")
                }
            }
        } label: {
            PickerChipLabel(
                icon: .monitorCog,
                title: draft.selectedEnvironment?.name ?? "No environment",
                maxTitleWidth: 132
            )
        }
        .menuIndicator(.hidden)
        .buttonStyle(.plain)
        .disabled(isLoading)
        .redacted(reason: isLoading ? .placeholder : [])
        .accessibilityLabel("Select environment")
        .task(id: draft.selectedRepo?.id) {
            await draft.loadEnvironments()
        }
        .onChange(of: scenePhase) { _, newPhase in
            // Refresh so an environment just created on web shows up.
            if newPhase == .active {
                Task { await draft.loadEnvironments() }
            }
        }
    }
}
