import CoreAPI
import SwiftUI

struct ModelPickerButton: View {
    @Environment(\.composerStyle) var composerStyle: ComposerStyle
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let draft: NewSessionDraft
    let providerId: ProviderId?
    let restrictsProvider: Bool
    @State private var isSheetPresented = false

    var body: some View {
        Menu {
            Section("Model") {
                Button(selectedModel?.displayName ?? "Select a model") {
                    isSheetPresented = true
                }
            }

            Section("Effort Level") {
                effortMenu
            }
        } label: {
            menuLabel
        }
        .menuIndicator(.hidden)
        .buttonStyle(.plain)
        .sheet(isPresented: $isSheetPresented) {
            ModelPickerSheet(
                draft: draft,
                providerId: providerId,
                restrictsProvider: restrictsProvider
            )
        }
    }

    @ViewBuilder
    private var effortMenu: some View {
        if let provider = selectedProvider {
            Menu(selectedModel?.effortDisplayName ?? "Select an effort level") {
                ForEach(provider.efforts, id: \.id) { effort in
                    Button {
                        draft.selectEffort(
                            provider: provider,
                            effort: effort,
                            persistsSelection: !restrictsProvider
                        )
                    } label: {
                        if selectedModel?.effortId == effort.id {
                            Label(effort.displayName, systemImage: "checkmark")
                        } else {
                            Text(effort.displayName)
                        }
                    }
                    .disabled(!effort.selectable)
                }
            }
        } else {
            Button("Select an effort level") {}
                .disabled(true)
        }
    }

    private var menuLabel: some View {
        HStack(spacing: style.gridSize * 0.75) {
            if let model = selectedModel {
                ProviderIconView(providerId: model.providerId)
                    .frame(width: 16, height: 16)
                Text(model.displayName)
                    .lineLimit(1)
            } else {
                Image(systemName: "cpu")
                Text("Select model")
                    .lineLimit(1)
            }
        }
        .styledFont(.caption)
        .foregroundStyle(theme.labelColor)
        .padding(.horizontal, 12)
        .frame(height: composerStyle.bottomButtonSize)
        .contentShape(Capsule())
        .glassBackground(in: Capsule())
    }

    private var selectedProvider: ProviderCatalogEntry? {
        guard let selectedModel else {
            return nil
        }
        return draft.modelCatalog?.providers.first {
            $0.providerId == selectedModel.providerId
        }
    }

    private var selectedModel: NewSessionDraft.SelectedModel? {
        guard let selectedModel = draft.selectedModel,
              !restrictsProvider || selectedModel.providerId == providerId else {
            return nil
        }
        return selectedModel
    }
}
