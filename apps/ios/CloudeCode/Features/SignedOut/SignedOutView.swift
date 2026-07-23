import AuthenticationServices
import SwiftUI

/// Login screen: app identity centered, GitHub sign-in pinned to the bottom.
struct SignedOutView: View {
    @Environment(\.showToast) private var showToast
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    let sessionStore: SessionStore

    var body: some View {
        ZStack {
            SignedOutStyle.backgroundGradient
                .ignoresSafeArea()

            Wordmark()
                .offset(y: SignedOutStyle.wordmarkVerticalOffset)

            VStack {
                Spacer()

                Button {
                    Task { await sessionStore.signIn(using: webAuthenticationSession) }
                } label: {
                    ZStack {
                        if sessionStore.isSigningIn {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Text("Sign in")
                        }
                    }
                    .font(SignedOutStyle.signInFont)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: SignedOutStyle.signInButtonHeight)
                    .contentShape(Capsule())
                    .glassBackground(in: .capsule, glass: .clear)
                }
                .disabled(sessionStore.isSigningIn)
                .padding(.horizontal, SignedOutStyle.horizontalPadding)
                .padding(.bottom, SignedOutStyle.bottomPadding)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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

private enum SignedOutStyle {
    static let wordmarkVerticalOffset: CGFloat = -25
    static let horizontalPadding: CGFloat = 16
    static let signInButtonHeight: CGFloat = 56
    static let bottomPadding: CGFloat = 4
    static let signInButtonTint = Color(hex: 0x102A5A)
    static let signInFont = Font.semibold(20)
    static let backgroundGradient = LinearGradient(
        colors: [Color(hex: 0x08122F), Color(hex: 0x040B22)],
        startPoint: .top,
        endPoint: .bottom
    )
}
