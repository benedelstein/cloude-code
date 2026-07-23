import AuthenticationServices
import SwiftUI
import UIKit

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
                }
                .buttonStyle(SignedOutClearGlassButtonStyle())
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

private struct Wordmark: View {
    private let machinesFont = UIFont(
        name: SignedOutStyle.machinesFontName,
        size: SignedOutStyle.wordmarkFontSize
    ) ?? .systemFont(ofSize: SignedOutStyle.wordmarkFontSize)

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: SignedOutStyle.wordmarkSpacing) {
            Text("My")
                .font(.custom(SignedOutStyle.schoolYardFontName, size: SignedOutStyle.wordmarkFontSize))

            // Use a dotless i so the lavender brand dot is the only dot rendered.
            Text("Mach\u{0131}nes")
                .font(.custom(SignedOutStyle.machinesFontName, size: SignedOutStyle.wordmarkFontSize))
                .overlay(alignment: .topLeading) {
                    Circle()
                        .fill(SignedOutStyle.dotColor)
                        .frame(width: SignedOutStyle.dotSize, height: SignedOutStyle.dotSize)
                        .offset(x: dotHorizontalOffset, y: SignedOutStyle.dotVerticalOffset)
                }
        }
        .foregroundStyle(.white)
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("My Machines")
    }

    private var dotHorizontalOffset: CGFloat {
        let prefixWidth = ("Mach" as NSString).size(withAttributes: [.font: machinesFont]).width
        let letterWidth = ("\u{0131}" as NSString).size(withAttributes: [.font: machinesFont]).width
        return prefixWidth + (letterWidth - SignedOutStyle.dotSize) / 2
    }
}

private enum SignedOutStyle {
    static let schoolYardFontName = "SchoolYardRegular"
    static let machinesFontName = "DMSerifDisplay-Regular"
    static let wordmarkFontSize: CGFloat = 58.5
    static let wordmarkSpacing: CGFloat = 4
    static let wordmarkVerticalOffset: CGFloat = -25
    static let dotSize: CGFloat = 10
    static let dotVerticalOffset: CGFloat = 14
    static let horizontalPadding: CGFloat = 16
    static let signInButtonHeight: CGFloat = 60
    static let bottomPadding: CGFloat = 4
    static let dotColor = Color(hex: 0xD4A8FF)
    static let buttonBorderColor = Color(hex: 0x6D768F)
    static let signInFont = Font.semibold(20)
    static let backgroundGradient = LinearGradient(
        colors: [Color(hex: 0x0A1534), Color(hex: 0x060F2A)],
        startPoint: .top,
        endPoint: .bottom
    )
}

private struct SignedOutClearGlassButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background {
                Capsule()
                    .fill(.clear)
                    .stroke(SignedOutStyle.buttonBorderColor, lineWidth: 0.5)
                    .shadow(color: .black.opacity(0.2), radius: 8, x: 0, y: 4)
            }
            .opacity(isEnabled ? 1 : 0.5)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}
