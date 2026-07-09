import SwiftUI

struct RepoBranchPickerBar: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let draft: NewSessionDraft
    @State private var isSheetPresented = false

    var body: some View {
        Button {
            isSheetPresented = true
        } label: {
            HStack(spacing: style.gridSize) {
                Image(systemName: "folder")
                    .frame(width: 20, height: 20)

                VStack(alignment: .leading, spacing: 2) {
                    Text(draft.selectedRepo?.fullName ?? "Select repository")
                        .styledFont(.subheadline)
                        .foregroundStyle(theme.labelColor)
                        .lineLimit(1)

                    if let branch = draft.selectedBranch {
                        Text(branch)
                            .styledFont(.caption)
                            .foregroundStyle(theme.secondaryLabelColor)
                            .lineLimit(1)
                    }
                }

                Spacer()

                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption)
                    .foregroundStyle(theme.tertiaryLabelColor)
            }
            .padding(.horizontal, style.spacing)
            .padding(.vertical, style.gridSize)
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .glassBackground(in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $isSheetPresented) {
            RepoBranchPickerSheet(draft: draft)
                .presentationDetents([.medium, .large])
        }
    }
}
