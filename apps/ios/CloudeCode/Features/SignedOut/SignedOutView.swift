import AuthenticationServices
import SwiftUI

/// Login screen: app identity centered, GitHub sign-in pinned to the bottom.
struct SignedOutView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style
    @Environment(\.showToast) private var showToast
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    let sessionStore: SessionStore

    var body: some View {
        VStack(spacing: style.spacing) {
            Spacer()

            VStack(spacing: style.spacing) {
            }

            Spacer()

            Button {
                Task { await sessionStore.signIn(using: webAuthenticationSession) }
            } label: {
                ZStack {
                    if sessionStore.isSigningIn {
                        ProgressView()
                            .tint(.white)
                    } else {
                        HStack(spacing: style.spacing) {
                            Image("GitHubMark")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 20, height: 20)
                            Text("Sign in")
                        }
                    }
                }
                .font(style.headlineFont)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: style.mainButtonHeight)
            }
            .glassButtonStyle(.glassProminent, tint: theme.accentBlue)
            .disabled(sessionStore.isSigningIn)
            .padding(.horizontal, style.horizontalPadding)
        }
        .padding(.bottom, style.spacing)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.backgroundColor)
        .onChange(of: sessionStore.signInError) { _, error in
            guard let error else {
                return
            }
            showToast?(
                title: Text(verbatim: error),
                icon: Image(systemName: "exclamationmark.circle.fill")
            )
        }
    }
}
