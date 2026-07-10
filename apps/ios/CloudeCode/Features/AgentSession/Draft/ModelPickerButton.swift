import CoreAPI
import SwiftUI

struct ModelPickerButton: View {
    @Environment(\.composerStyle) var composerStyle: ComposerStyle
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let modelCatalog: ModelCatalogStore
    let selectedModel: ModelSelection?
    let providerId: ProviderId?
    let restrictsProvider: Bool
    let isLoadingSelection: Bool
    let onSelectModel: (ProviderCatalogEntry, ProviderCatalogModel) -> Void
    let onSelectEffort: (ProviderCatalogEntry, ProviderCatalogEffort) -> Void
    @State private var isSheetPresented = false

    var body: some View {
        Menu {
            Section("Model") {
                Button(displayedModel?.displayName ?? "Select a model") {
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
        .disabled(isLoadingSelection)
        .redacted(reason: isLoadingSelection ? .placeholder : [])
        .sheet(isPresented: $isSheetPresented) {
            ModelPickerSheet(
                modelCatalog: modelCatalog,
                selectedModel: displayedModel,
                providerId: providerId,
                restrictsProvider: restrictsProvider,
                onSelectModel: onSelectModel
            )
        }
    }

    @ViewBuilder
    private var effortMenu: some View {
        if let provider = selectedProvider {
            Menu(displayedModel?.effortDisplayName ?? "Select an effort level") {
                ForEach(provider.efforts, id: \.id) { effort in
                    Button {
                        onSelectEffort(provider, effort)
                    } label: {
                        if displayedModel?.effortId == effort.id {
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
            if let model = displayedModel {
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
        guard let displayedModel else {
            return nil
        }
        return modelCatalog.catalog?.providers.first {
            $0.providerId == displayedModel.providerId
        }
    }

    private var displayedModel: ModelSelection? {
        guard let selectedModel,
              !restrictsProvider || selectedModel.providerId == providerId else {
            return nil
        }
        return selectedModel
    }
}
