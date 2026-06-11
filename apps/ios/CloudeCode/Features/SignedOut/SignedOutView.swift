import SwiftUI

/// Signed-out placeholder. Real login (ASWebAuthenticationSession) comes in a
/// later change; DEBUG builds get a token-injection form for testing.
struct SignedOutView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let sessionStore: SessionStore

    #if DEBUG
    @State private var refreshToken = ""
    @State private var userId = ""
    @State private var isInjecting = false
    #endif

    var body: some View {
        VStack(spacing: style.spacing) {
            Spacer()

            Text("Cloude Code")
                .styledFont(.title2)
            Text("Sign in to continue")
                .styledFont(.subheadline)
                .foregroundStyle(theme.secondaryLabelColor)

            #if DEBUG
            devSessionForm
            #endif

            Spacer()
        }
        .padding()
    }

    #if DEBUG
    private var devSessionForm: some View {
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
            .buttonStyle(.borderedProminent)
            .disabled(isInjecting || refreshToken.isEmpty || userId.isEmpty)
        }
        .padding(.top)
    }
    #endif
}
