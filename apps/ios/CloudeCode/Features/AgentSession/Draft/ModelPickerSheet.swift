import CoreAPI
import SwiftUI

struct ModelPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme

    let draft: NewSessionDraft

    var body: some View {
        NavigationStack {
            List {
                if let catalog = draft.catalog {
                    ForEach(catalog.providers, id: \.providerId.rawValue) { provider in
                        providerSection(provider)
                    }
                } else if draft.isLoadingCatalog {
                    ProgressView()
                        .frame(maxWidth: .infinity, alignment: .center)
                } else {
                    ContentUnavailableView(
                        "No models",
                        systemImage: "cpu",
                        description: Text("Model catalog is unavailable.")
                    )
                }
            }
            .scrollContentBackground(.hidden)
            .background(theme.secondaryBackgroundColor)
            .navigationTitle("Model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func providerSection(_ provider: ProviderCatalogEntry) -> some View {
        Section {
            ForEach(provider.models, id: \.id) { model in
                Button {
                    draft.selectModel(provider: provider, model: model)
                    // swiftlint:disable:next todo
                    // TODO: effort level
                    dismiss()
                } label: {
                    HStack(spacing: 12) {
                        ProviderIconView(providerId: provider.providerId)
                            .frame(width: 18, height: 18)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.displayName)
                                .foregroundStyle(theme.labelColor)
                            Text(model.id)
                                .font(.caption)
                                .foregroundStyle(theme.tertiaryLabelColor)
                        }
                        Spacer()
                        if draft.selectedModel?.providerId == provider.providerId,
                           draft.selectedModel?.modelId == model.id {
                            Image(systemName: "checkmark")
                                .foregroundStyle(theme.accentBlue)
                        }
                    }
                }
                .disabled(!provider.canSelectModels || !model.selectable)
            }
        } header: {
            HStack(spacing: 8) {
                Text(provider.providerName)
                if !provider.canSelectModels {
                    Text(provider.requiresReauth ? "Reconnect required" : "Disconnected")
                        .foregroundStyle(theme.tertiaryLabelColor)
                }
            }
        }
        .disabled(!provider.canSelectModels)
    }
}

private extension ProviderCatalogEntry {
    var canSelectModels: Bool {
        connected && !requiresReauth
    }
}
