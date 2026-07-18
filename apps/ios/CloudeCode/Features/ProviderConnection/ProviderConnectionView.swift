import CoreAPI
import Domain
import SwiftUI
import UIKit

/// Shared native sheet shell for provider-specific account connection flows.
struct ProviderConnectionView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.theme) private var theme

    @State private var viewModel: ProviderConnectionViewModel
    let onConnected: () -> Void

    init(
        viewModel: ProviderConnectionViewModel,
        onConnected: @escaping () -> Void
    ) {
        _viewModel = State(initialValue: viewModel)
        self.onConnected = onConnected
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    providerHeader
                }

                switch viewModel.context.providerId {
                case .claudeCode:
                    ClaudeFlow(viewModel: viewModel)
                case .openaiCodex:
                    OpenAIFlow(viewModel: viewModel)
                case .unknown:
                    Text("This provider cannot be connected in this version of the app.")
                        .foregroundStyle(theme.secondaryLabelColor)
                }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .disabled(viewModel.isWorking)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(viewModel.isWorking)
        .onChange(of: viewModel.isConnected) { _, isConnected in
            guard isConnected else { return }
            onConnected()
            dismiss()
        }
        .onChange(of: viewModel.externalAuthorization) { _, authorization in
            guard let authorization else { return }
            openAuthorization(authorization)
            viewModel.didOpenExternalAuthorization()
        }
        .onDisappear {
            viewModel.unload()
        }
    }

    private var providerHeader: some View {
        HStack(spacing: 12) {
            ProviderIconView(providerId: viewModel.context.providerId)
                .frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(viewModel.context.providerName)
                    .font(.headline)
                Text(viewModel.context.requiresReauth ? "Reconnect required" : "Not connected")
                    .font(.caption)
                    .foregroundStyle(theme.secondaryLabelColor)
            }
        }
    }

    private var navigationTitle: String {
        let action = viewModel.context.requiresReauth ? "Reconnect" : "Connect"
        return "\(action) \(viewModel.context.providerName)"
    }

    private func openAuthorization(
        _ authorization: ProviderConnectionViewModel.ExternalAuthorization
    ) {
        if let code = authorization.codeToCopy {
            UIPasteboard.general.string = code
        }
        openURL(authorization.url)
    }
}

extension ProviderConnectionView {
    struct ClaudeFlow: View {
        @Environment(\.theme) private var theme
        @Bindable var viewModel: ProviderConnectionViewModel

        var body: some View {
            Section {
                if viewModel.phase == .claudeCodeEntry {
                    TextField("Paste code", text: $viewModel.claudeCode, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(viewModel.isWorking)

                    Button(viewModel.isWorking ? "Completing sign in…" : "Complete sign in") {
                        viewModel.submitClaudeCode()
                    }
                    .disabled(
                        viewModel.isWorking
                            || viewModel.claudeCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )

                    Button("Cancel", role: .cancel) {
                        viewModel.cancelClaudeCodeEntry()
                    }
                    .disabled(viewModel.isWorking)
                } else {
                    instructions
                    Button(actionLabel) {
                        viewModel.connect()
                    }
                    .disabled(viewModel.isWorking)
                }

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(theme.errorRed)
                }
            } header: {
                Text("Sign in with Claude")
            }
        }

        private var instructions: some View {
            VStack(alignment: .leading, spacing: 8) {
                Text(viewModel.context.requiresReauth
                     ? "Your Claude session expired. Reconnect your account to continue."
                     : "Connect your Claude account to use Claude models.")
                Label("Authorize Claude in Safari.", systemImage: "1.circle")
                Label("Copy the code from Claude and return here.", systemImage: "2.circle")
                Label("Paste the code to finish signing in.", systemImage: "3.circle")
            }
            .font(.subheadline)
            .foregroundStyle(theme.secondaryLabelColor)
        }

        private var actionLabel: String {
            if viewModel.isWorking {
                return "Opening Claude…"
            }
            return viewModel.context.requiresReauth ? "Reconnect Claude" : "Sign in with Claude"
        }
    }

    struct OpenAIFlow: View {
        @Environment(\.theme) private var theme
        @Bindable var viewModel: ProviderConnectionViewModel

        var body: some View {
            Section {
                if case .openAIWaiting(let authorization) = viewModel.phase {
                    Text("This code was copied to your clipboard. Paste it on the ChatGPT authorization page.")
                        .font(.subheadline)
                        .foregroundStyle(theme.secondaryLabelColor)

                    LabeledContent("Code") {
                        Text(authorization.userCode)
                            .font(.system(.body, design: .monospaced).weight(.semibold))
                            .textSelection(.enabled)
                    }

                    Button("Copy code and open ChatGPT") {
                        viewModel.reopenOpenAIAuthorization()
                    }

                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Waiting for authorization…")
                            .font(.subheadline)
                            .foregroundStyle(theme.secondaryLabelColor)
                    }
                } else {
                    Text(viewModel.context.requiresReauth
                         ? "Your OpenAI Codex session expired. Reconnect to continue."
                         : "Connect your OpenAI account to use Codex models.")
                        .font(.subheadline)
                        .foregroundStyle(theme.secondaryLabelColor)

                    Label {
                        Text("Device-code authentication must be enabled in ChatGPT Security settings.")
                    } icon: {
                        Image(systemName: "exclamationmark.triangle")
                    }
                    .font(.caption)
                    .foregroundStyle(theme.accentOrange)

                    if let settingsURL = URL(string: "https://chatgpt.com/#settings/Security") {
                        Link("Open ChatGPT Security settings", destination: settingsURL)
                    }

                    Button(actionLabel) {
                        viewModel.connect()
                    }
                    .disabled(viewModel.isWorking)
                }

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(theme.errorRed)
                }
            } header: {
                Text("Sign in with ChatGPT")
            }
        }

        private var actionLabel: String {
            if viewModel.isWorking {
                return "Preparing sign in…"
            }
            return viewModel.context.requiresReauth ? "Reconnect OpenAI" : "Sign in with ChatGPT"
        }
    }
}
