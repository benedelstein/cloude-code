import CoreAPI
import SwiftUI

struct ModelPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme

    let modelCatalog: ModelCatalogStore
    let selectedModel: ModelSelection?
    let providerId: ProviderId?
    let restrictsProvider: Bool
    let onSelectModel: (ProviderCatalogEntry, ProviderCatalogModel) -> Void
    let onConnectProvider: (ProviderCatalogEntry) -> Void
    @State private var query = ""
    @State private var collapsedProviderIDs = Set<String>()

    var body: some View {
        NavigationStack {
            List {
                if let catalog = modelCatalog.catalog {
                    let providers = filteredProviders(in: catalog)
                    if providers.isEmpty {
                        EmptyStateView(
                            title: "No models found",
                            subtitle: "Try a different search."
                        ) {
                            Image(systemName: "cpu")
                        }
                        .listRowBackground(Color.clear)
                    } else {
                        ForEach(providers, id: \.providerId.rawValue) { provider in
                            providerSection(provider)
                        }
                    }
                } else if modelCatalog.isLoading {
                    loadingRows
                } else {
                    ErrorStateView(
                        title: "No models",
                        subtitle: "Model catalog is unavailable."
                    ) {
                        Image(systemName: "cpu")
                    }
                    .listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .contentMargins(.top, 0, for: .scrollContent)
            .navigationTitle("Select Model")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .automatic)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .presentationDetents([.medium, .large])
            // Self-heals after an earlier load failure; no-ops once loaded.
            .task {
                await modelCatalog.load()
            }
        }
    }

    private func providerSection(_ provider: ProviderCatalogEntry) -> some View {
        let isExpanded = isSearching || !collapsedProviderIDs.contains(provider.providerId.rawValue)

        return Section {
            if isExpanded {
                if !provider.isSelectable {
                    providerConnectionRow(provider)
                }
                providerRows(provider, models: filteredModels(for: provider))
            }
        } header: {
            providerHeader(provider, isExpanded: isExpanded)
        }
    }

    @ViewBuilder
    private func providerConnectionRow(_ provider: ProviderCatalogEntry) -> some View {
        if provider.providerId.supportsNativeConnection {
            Button {
                onConnectProvider(provider)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "link")
                        .font(.body.weight(.semibold))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(provider.requiresReauth
                             ? "Reconnect \(provider.providerName)"
                             : "Connect \(provider.providerName)")
                            .font(.body.weight(.semibold))

                        Text(provider.requiresReauth
                             ? "Sign in again to use these models."
                             : "Connect to use these models.")
                            .font(.caption)
                            .foregroundStyle(theme.secondaryLabelColor)
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                }
                .foregroundStyle(theme.accentBlue)
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowBackground(theme.accentBlue.opacity(0.1))
        } else {
            Text("Not connected")
                .foregroundStyle(theme.tertiaryLabelColor)
        }
    }

    private func providerRows(
        _ provider: ProviderCatalogEntry,
        models: [ProviderCatalogModel]
    ) -> some View {
        ForEach(models, id: \.id) { model in
            ModelRow(
                displayName: model.displayName,
                isSelected: selectedModel?.providerId == provider.providerId
                    && selectedModel?.modelId == model.id,
                isEnabled: provider.isSelectable && model.selectable
            ) {
                onSelectModel(provider, model)
                dismiss()
            }
        }
    }

    private var loadingRows: some View {
        Section {
            ForEach(0 ..< 6, id: \.self) { _ in
                ModelRow(
                    displayName: "Model display name",
                    isSelected: false,
                    isEnabled: false
                ) {}
                .redacted(reason: .placeholder)
            }
        } header: {
            Text(verbatim: "Provider name")
                .redacted(reason: .placeholder)
        }
    }

    private func providerHeader(_ provider: ProviderCatalogEntry, isExpanded: Bool) -> some View {
        Button {
            withAnimation {
                toggleProvider(provider)
            }
        } label: {
            HStack(spacing: 8) {
                // One constant image with a rotation and fixed width so
                // toggling expansion never shifts the header layout.
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    .frame(width: 14)
                ProviderIconView(providerId: provider.providerId)
                    .frame(width: 14, height: 14)
                Text(provider.providerName)

                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isSearching: Bool {
        !trimmedQuery.isEmpty
    }

    private func filteredProviders(in catalog: ModelsResponse) -> [ProviderCatalogEntry] {
        // The store pre-sorts providers (selectable first); only the selected
        // provider needs hoisting here because it depends on the selection.
        var providers = catalog.providers.filter { provider in
            (!restrictsProvider || provider.providerId == providerId)
                && !filteredModels(for: provider).isEmpty
        }
        if let selectedIndex = providers.firstIndex(where: {
            $0.providerId == selectedModel?.providerId
        }), selectedIndex > 0 {
            providers.insert(providers.remove(at: selectedIndex), at: 0)
        }
        return providers
    }

    private func filteredModels(for provider: ProviderCatalogEntry) -> [ProviderCatalogModel] {
        guard isSearching else {
            return provider.models
        }

        return provider.models.filter { model in
            provider.providerName.localizedCaseInsensitiveContains(trimmedQuery)
                || model.displayName.localizedCaseInsensitiveContains(trimmedQuery)
        }
    }

    private func toggleProvider(_ provider: ProviderCatalogEntry) {
        if collapsedProviderIDs.contains(provider.providerId.rawValue) {
            collapsedProviderIDs.remove(provider.providerId.rawValue)
        } else {
            collapsedProviderIDs.insert(provider.providerId.rawValue)
        }
    }

    private struct ModelRow: View {
        @Environment(\.theme) private var theme

        let displayName: String
        let isSelected: Bool
        let isEnabled: Bool
        let onSelect: () -> Void

        var body: some View {
            Button(action: onSelect) {
                HStack {
                    Text(displayName)
                        .foregroundStyle(theme.labelColor)
                    Spacer()
                    if isSelected {
                        Image(systemName: "checkmark")
                            .foregroundStyle(theme.accentBlue)
                    }
                }
            }
            .disabled(!isEnabled)
            .opacity(isEnabled ? 1 : 0.4)
        }
    }
}

private extension ProviderId {
    var supportsNativeConnection: Bool {
        switch self {
        case .claudeCode, .openaiCodex:
            true
        case .unknown:
            false
        }
    }
}
