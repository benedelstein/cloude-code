import AuthenticationServices
import SwiftUI

/// Login screen: app identity centered, GitHub sign-in pinned to the bottom.
/// DEBUG builds keep a collapsed token-injection form for testing.
struct SignedOutView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style
    @Environment(\.showToast) private var showToast
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    let sessionStore: SessionStore

    #if DEBUG
    @State private var showsDevForm = false
    @State private var refreshToken = ""
    @State private var userId = ""
    @State private var isInjecting = false
    #endif

    var body: some View {
        VStack(spacing: style.spacing) {
            Spacer()

            VStack(spacing: style.spacing) {
                Text("☁️")
                    .styledFont(.largeTitle)
                Text("Cloude Code")
                    .font(style.largeTitleFont.weight(.semibold))
                    .foregroundStyle(theme.labelColor)
            }

            Spacer()

            Button {
                Task { await sessionStore.signIn(using: webAuthenticationSession) }
            } label: {
                HStack(spacing: style.spacing) {
                    Image("GitHubMark")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 20, height: 20)
                    Text("Sign in")
                }
            }
            .buttonStyle(GlassButtonStyle(tint: theme.accentBlue, isLoading: sessionStore.isSigningIn))
            .disabled(sessionStore.isSigningIn)
            .padding(.horizontal, style.horizontalPadding)

            #if DEBUG
            devSection
            #endif
        }
        .padding(.bottom, style.spacing)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.backgroundColor)
        .onChange(of: sessionStore.signInError) { _, error in
            guard let error else {
                return
            }
            showToast?(
                verbatimTitle: error,
                icon: Image(systemName: "exclamationmark.circle.fill")
            )
        }
    }

    #if DEBUG
    @ViewBuilder
    private var devSection: some View {
        Button("Dev") {
            showsDevForm.toggle()
        }
        .styledFont(.caption)
        .foregroundStyle(theme.secondaryLabelColor)

        if showsDevForm {
            VStack(spacing: style.spacing) {
                TextField("Refresh token", text: $refreshToken)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                TextField("User ID", text: $userId)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                Button("Inject dev session") {
                    isInjecting = true
                    Task {
                        await sessionStore.injectDevSession(
                            refreshToken: refreshToken.trimmingCharacters(in: .whitespacesAndNewlines),
                            userId: userId.trimmingCharacters(in: .whitespacesAndNewlines)
                        )
                        isInjecting = false
                    }
                }
                .disabled(isInjecting || refreshToken.isEmpty || userId.isEmpty)
            }
            .padding(.horizontal, style.horizontalPadding)
        }
    }
    #endif
}
