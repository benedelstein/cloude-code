import CoreAPI
import SwiftUI

/// Native Claude account connection screen.
struct ClaudeProviderConnectionView: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.style) private var style
    @Environment(\.theme) private var theme

    @State var viewModel: ClaudeProviderConnectionViewModel
    let onConnected: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 24) {
                hero

                if viewModel.phase == .awaitingCode || viewModel.phase == .submitting {
                    codeEntry
                } else {
                    instructions
                }

                if let errorMessage = viewModel.errorMessage {
                    error(message: errorMessage)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, style.horizontalPadding)
            .padding(.top, 24)

            actionArea
                .padding(.top, 32)
        }
        .animation(.easeIn, value: viewModel.phase)
        .onChange(of: viewModel.externalAuthorizationURL) { _, url in
            guard let url else { return }
            openURL(url)
            viewModel.didOpenExternalAuthorization()
        }
        .onChange(of: viewModel.isConnected) { _, isConnected in
            guard isConnected else { return }
            onConnected()
        }
        .onDisappear {
            viewModel.unload()
        }
    }

    private var hero: some View {
        ProviderConnectionHeroView(
            providerId: .claudeCode,
            title: heroTitle,
            subtitle: heroSubtitle
        )
    }

    private var heroTitle: LocalizedStringKey {
        viewModel.phase == .awaitingCode || viewModel.phase == .submitting
            ? "Finish connecting Claude"
            : "Sign in with Claude"
    }

    private var heroSubtitle: LocalizedStringKey {
        if viewModel.phase == .awaitingCode || viewModel.phase == .submitting {
            return "Paste the authorization code from Claude to finish connecting your account."
        }
        if viewModel.context.requiresReauth {
            return "Your Claude session expired. Reconnect to continue using Claude models."
        }
        return "Connect your Claude account to use Claude models in Cloude Code."
    }

    private var instructions: some View {
        VStack(alignment: .leading, spacing: 16) {
            instruction(number: 1, text: "Open Claude and approve access.")
            instruction(number: 2, text: "Copy the authorization code Claude gives you.")
            instruction(number: 3, text: "Return here and paste the code.")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var codeEntry: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Authorization code")
                .font(style.captionFont.weight(.semibold))
                .foregroundStyle(theme.secondaryLabelColor)

            TextField("Paste code", text: $viewModel.code, axis: .vertical)
                .font(style.bodyFont)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(14)
                .background(theme.secondaryBackgroundColor, in: RoundedRectangle(cornerRadius: 14))
                .disabled(viewModel.isWorking)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var actionArea: some View {
        VStack(spacing: 0) {
            if viewModel.phase == .awaitingCode || viewModel.phase == .submitting {
                Button {
                    if viewModel.canSubmitCode {
                        viewModel.submitCode()
                    } else {
                        viewModel.reopenAuthorization()
                    }
                } label: {
                    buttonLabel(
                        title: viewModel.canSubmitCode ? "Connect Claude" : "Open Claude again",
                        image: .providerAnthropic
                    )
                }
                .buttonStyle(.main(isLoading: viewModel.phase == .submitting))
                .disabled(viewModel.isWorking)
            } else {
                Button {
                    viewModel.beginAuthorization()
                } label: {
                    buttonLabel(
                        title: "Continue with Claude",
                        image: .providerAnthropic
                    )
                }
                .buttonStyle(.main(isLoading: viewModel.phase == .preparing))
                .disabled(viewModel.isWorking)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, style.horizontalPadding)
        .padding(.bottom, 12)
    }

    private func instruction(number: Int, text: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(verbatim: "\(number)")
                .font(style.captionFont.weight(.semibold))
                .frame(width: 26, height: 26)
                .background(theme.secondaryBackgroundColor, in: Circle())

            Text(text)
                .font(style.subheadlineFont)
                .foregroundStyle(theme.secondaryLabelColor)
                .padding(.top, 3)
        }
    }

    private func buttonLabel(title: LocalizedStringKey, image: ImageResource) -> some View {
        HStack(spacing: 8) {
            Image(image)
                .resizable()
                .renderingMode(.template)
                .aspectRatio(contentMode: .fit)
                .frame(width: 17, height: 17)
            Text(title)
        }
    }

    private func error(message: String) -> some View {
        CalloutView(tint: theme.errorRed, systemImage: "exclamationmark.circle") {
            Text(verbatim: message)
        }
    }
}
