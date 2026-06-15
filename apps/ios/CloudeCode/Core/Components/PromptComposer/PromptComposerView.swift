import SwiftUI

struct PromptComposerView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    @Binding private var text: String
    private let focused: FocusState<Bool>.Binding?
    private let placeholder: String
    private let isSubmitDisabled: Bool
    private let isSubmitting: Bool
    private let onSubmit: () -> Void
    private let onLeadingAction: (() -> Void)?

    init(
        text: Binding<String>,
        focused: FocusState<Bool>.Binding? = nil,
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

            composerEditor

            Button(action: onSubmit) {
                ZStack {
                    if isSubmitting {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: style.gridSize * 3.5))
                    }
                }
                .frame(width: style.gridSize * 4, height: style.gridSize * 4)
            }
            .buttonStyle(.plain)
            .foregroundStyle(isSubmitDisabled ? theme.secondaryLabelColor : theme.accentBlue)
            .disabled(isSubmitDisabled || isSubmitting)
            .accessibilityLabel("Send")
        }
        .padding(style.gridSize)
        .promptComposerGlassBackground(
            in: RoundedRectangle(cornerRadius: style.gridSize * 2.5, style: .continuous),
            fallbackColor: theme.secondaryBackgroundColor
        )
    }

    @ViewBuilder
    private var composerEditor: some View {
        if let focused {
            editorBody
                .focused(focused)
        } else {
            editorBody
        }
    }

    private var editorBody: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(placeholder)
                    .styledFont(.body)
                    .foregroundStyle(theme.secondaryLabelColor)
                    .padding(.horizontal, style.gridSize / 2)
                    .padding(.vertical, style.gridSize)
            }

            TextEditor(text: $text)
                .styledFont(.body)
                .foregroundStyle(theme.labelColor)
                .scrollContentBackground(.hidden)
                .frame(minHeight: style.gridSize * 5, maxHeight: style.gridSize * 15)
                .padding(.horizontal, -style.gridSize / 2)
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
