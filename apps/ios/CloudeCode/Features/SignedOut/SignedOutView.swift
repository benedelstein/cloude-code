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
                }
                .glassButtonStyle(.glass, tint: SignedOutStyle.signInButtonTint)
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.softFeedback) private var softFeedback
    @State private var isVisible = false
    @State private var extraEyeCount = 0
    @State private var eyeSequenceID = 0
    @State private var toggleTargetEyeCount: Int?

    var body: some View {
        Button {
            toggleEyes()
        } label: {
            ZStack {
                if isVisible {
                    HStack(alignment: .firstTextBaseline, spacing: SignedOutStyle.wordmarkSpacing) {
                        Text("My")
                            .font(.custom(SignedOutStyle.schoolbellFontName, size: SignedOutStyle.myFontSize))

                        HStack(alignment: .firstTextBaseline, spacing: 0) {
                            Text("Mach")

                            WordmarkI()

                            if extraEyeCount >= 1 {
                                WordmarkI()
                                    .transition(extraEyeTransition)
                            }

                            if extraEyeCount >= 2 {
                                WordmarkI()
                                    .transition(extraEyeTransition)
                            }

                            if extraEyeCount >= 3 {
                                WordmarkI()
                                    .transition(extraEyeTransition)
                            }

                            if extraEyeCount >= 4 {
                                WordmarkI()
                                    .transition(extraEyeTransition)
                            }

                            Text("nes")
                        }
                        .font(.custom(SignedOutStyle.machinesFontName, size: SignedOutStyle.machinesFontSize))
                    }
                    .transition(.blurReplace)
                }
            }
            .foregroundStyle(.white)
            .fixedSize()
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .buttonStyle(.highlight(cornerRadius: 14, highlightColor: .white.opacity(0.08)))
        .accessibilityLabel("My Machines")
        .accessibilityHint("Toggles the animated eyes")
        .task(id: eyeSequenceID) {
            if let toggleTargetEyeCount {
                await animateEyes(to: toggleTargetEyeCount)
            } else {
                await animateIntro()
            }
        }
    }

    private var extraEyeTransition: AnyTransition {
        .asymmetric(
            insertion: .scale(scale: 0.2, anchor: .bottom)
                .combined(with: .opacity),
            removal: .opacity
                .animation(.easeOut(duration: 0.2))
        )
    }

    private var eyeInsertionAnimation: Animation {
        .spring(duration: 0.52, bounce: 0.38)
    }

    private var eyeRemovalAnimation: Animation {
        .spring(duration: 0.3, bounce: 0.15)
    }

    @MainActor
    private func animateIntro() async {
        guard !isVisible else {
            return
        }

        if reduceMotion {
            isVisible = true
            return
        }

        guard await wait(milliseconds: 300) else {
            return
        }

        withAnimation(.easeOut(duration: 0.42)) {
            isVisible = true
        }

        guard await wait(milliseconds: 850) else {
            return
        }

        await animateEyes(to: SignedOutStyle.maximumExtraEyeCount)

        guard await wait(milliseconds: 750) else {
            return
        }

        await animateEyes(to: 0)
    }

    @MainActor
    private func animateEyes(to targetCount: Int) async {
        if reduceMotion {
            extraEyeCount = targetCount
            return
        }

        while extraEyeCount != targetCount {
            guard !Task.isCancelled else {
                return
            }

            let isExpanding = extraEyeCount < targetCount
            let nextCount = extraEyeCount + (isExpanding ? 1 : -1)
            transitionEyes(
                to: nextCount,
                animation: isExpanding ? eyeInsertionAnimation : eyeRemovalAnimation
            )

            guard nextCount != targetCount else {
                return
            }

            let staggerMilliseconds = isExpanding ? 70 : 65
            guard await wait(milliseconds: staggerMilliseconds) else {
                return
            }
        }
    }

    @MainActor
    private func toggleEyes() {
        guard isVisible else {
            return
        }

        let nextTarget: Int
        if let toggleTargetEyeCount {
            nextTarget = toggleTargetEyeCount == SignedOutStyle.maximumExtraEyeCount
                ? 0
                : SignedOutStyle.maximumExtraEyeCount
        } else {
            nextTarget = extraEyeCount == 0 ? SignedOutStyle.maximumExtraEyeCount : 0
        }

        toggleTargetEyeCount = nextTarget
        eyeSequenceID += 1
    }

    @MainActor
    private func wait(milliseconds: Int) async -> Bool {
        do {
            try await Task.sleep(for: .milliseconds(milliseconds))
            return !Task.isCancelled
        } catch {
            return false
        }
    }

    @MainActor
    private func transitionEyes(to count: Int, animation: Animation) {
        softFeedback.impactOccurred(intensity: 0.6)
        withAnimation(animation) {
            extraEyeCount = count
        }
    }
}

private struct WordmarkI: View {
    var body: some View {
        // The dotless glyph lets the lavender brand dot animate independently.
        Text("\u{0131}")
            .overlay(alignment: .top) {
                Circle()
                    .fill(SignedOutStyle.dotColor)
                    .frame(width: SignedOutStyle.dotSize, height: SignedOutStyle.dotSize)
                    .offset(y: SignedOutStyle.dotVerticalOffset)
            }
    }
}

private enum SignedOutStyle {
    static let schoolbellFontName = "Schoolbell-Regular"
    static let machinesFontName = "DMSerifDisplay-Regular"
    static let myFontSize: CGFloat = 50
    static let machinesFontSize: CGFloat = 55
    static let maximumExtraEyeCount = 4
    static let wordmarkSpacing: CGFloat = 4
    static let wordmarkVerticalOffset: CGFloat = -25
    static let dotSize: CGFloat = 10
    static let dotVerticalOffset: CGFloat = 14
    static let horizontalPadding: CGFloat = 16
    static let signInButtonHeight: CGFloat = 60
    static let bottomPadding: CGFloat = 4
    static let dotColor = Color(hex: 0xD4A8FF)
    static let signInButtonTint = Color(hex: 0x102A5A)
    static let signInFont = Font.semibold(20)
    static let backgroundGradient = LinearGradient(
        colors: [Color(hex: 0x08122F), Color(hex: 0x040B22)],
        startPoint: .top,
        endPoint: .bottom
    )
}
