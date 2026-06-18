import SwiftUI
import SwiftUIIntrospect

struct PromptComposerView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style
    @Environment(\.lightFeedback) private var lightFeedback: UIImpactFeedbackGenerator

    @Binding private var text: String
    private let focused: FocusState<Bool>.Binding
    private let placeholder: String
    private let isSubmitDisabled: Bool
    private let isSubmitting: Bool
    private let onSubmit: () -> Void
    private let onLeadingAction: (() -> Void)?

    init(
        text: Binding<String>,
        focused: FocusState<Bool>.Binding,
        placeholder: String,
        isSubmitDisabled: Bool,
        isSubmitting: Bool = false,
        onSubmit: @escaping () -> Void,
        onLeadingAction: (() -> Void)? = nil
    ) {
        _text = text
        self.focused = focused
        self.placeholder = placeholder
        self.isSubmitDisabled = isSubmitDisabled
        self.isSubmitting = isSubmitting
        self.onSubmit = onSubmit
        self.onLeadingAction = onLeadingAction
    }

    var body: some View {
        VStack(spacing: style.gridSize) {
            composerEditor
            bottomBar
                .padding(8)
        }
        .promptComposerGlassBackground(
            in: RoundedRectangle(cornerRadius: 24, style: .continuous),
            fallbackColor: theme.secondaryBackgroundColor
        )
    }

    var bottomBar: some View {
        HStack(alignment: .bottom, spacing: style.gridSize) {
            if let onLeadingAction {
                Button(action: onLeadingAction) {
                    Image(systemName: "paperclip")
                        .frame(width: style.gridSize * 4, height: style.gridSize * 4)
                }
                .buttonStyle(.plain)
                .foregroundStyle(theme.secondaryLabelColor)
                .accessibilityLabel("Add attachment")
            }

            Spacer()

            sendButton
        }
    }

    var sendButton: some View {
        Button(
            action: {
            lightFeedback.impactOccurred()
            onSubmit()
            },
            label: {
                ZStack {
                    Circle()
                        .fill(isSubmitting || isSubmitDisabled ? .gray : theme.accentBlue)

                    if isSubmitting {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                }
                .frame(width: 32, height: 32)
            }
        )
        .buttonStyle(.plain)
        .foregroundStyle(isSubmitDisabled ? theme.secondaryLabelColor : theme.accentBlue)
        .disabled(isSubmitDisabled || isSubmitting)
        .accessibilityLabel("Send")
    }

    @ViewBuilder
    private var composerEditor: some View {
        editorBody
            .focused(focused)
    }

    private var editorBody: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(placeholder)
                    .styledFont(.body)
                    .foregroundStyle(theme.tertiaryLabelColor)
                    .padding(.top, 20)
                    .padding(.leading, 8)
            }

            TextEditor(text: $text)
                .styledFont(.body)
                .foregroundStyle(theme.labelColor)
                .scrollContentBackground(.hidden)
                .introspect(.textEditor, on: .iOS(.v17, .v18, .v26, .v27)) { textView in
                    textView.textContainerInset = UIEdgeInsets(
                        top: 20,
                        left: 8,
                        bottom: 12,
                        right: 8
                    )
                    textView.textContainer.lineFragmentPadding = 0
                }
                .frame(minHeight: style.gridSize * 5, maxHeight: style.gridSize * 15)
                .fixedSize(horizontal: false, vertical: true)
                .background(Color.clear)
        }
    }
}

private extension View {
    @ViewBuilder
    func promptComposerGlassBackground<S: Shape>(
        in shape: S,
        fallbackColor: Color
    ) -> some View {
        if #available(iOS 26.0, *) {
            glassEffect(.regular.interactive(), in: shape)
        } else {
            background(shape.fill(fallbackColor))
        }
    }
}
