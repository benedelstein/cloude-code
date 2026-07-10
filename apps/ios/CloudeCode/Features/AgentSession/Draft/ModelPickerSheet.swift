import CoreAPI
import SwiftUI

struct ModelPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme

    let modelPicker: ModelPickerState
    let selectedModel: ModelPickerState.SelectedModel?
    let providerId: ProviderId?
    let restrictsProvider: Bool
    let onSelectModel: (ProviderCatalogEntry, ProviderCatalogModel) -> Void
    @State private var query = ""
    @State private var collapsedProviderIDs = Set<String>()

    var body: some View {
        NavigationStack {
            List {
                if let catalog = modelPicker.modelCatalog {
                    if filteredProviders(in: catalog).isEmpty {
                        EmptyStateView(
                            title: "No models found",
                            subtitle: "Try a different search."
                        ) {
                            Image(systemName: "cpu")
                        }
                        .listRowBackground(Color.clear)
                    } else {
                        ForEach(filteredProviders(in: catalog), id: \.providerId.rawValue) { provider in
                            providerSection(provider)
                        }
                    }
                } else if modelPicker.isLoading {
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
        }
    }

    private func providerSection(_ provider: ProviderCatalogEntry) -> some View {
        let isExpanded = isSearching || !collapsedProviderIDs.contains(provider.providerId.rawValue)

        return Section {
            if isExpanded {
                providerRows(provider, models: filteredModels(for: provider))
            }
        } header: {
            providerHeader(provider, isExpanded: isExpanded)
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
                isEnabled: provider.canSelectModels && model.selectable
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
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption.weight(.semibold))
                ProviderIconView(providerId: provider.providerId)
                    .frame(width: 14, height: 14)
                Text(provider.providerName)
                Spacer()
                if !provider.canSelectModels {
                    Text(provider.requiresReauth ? "Reconnect required" : "Disconnected")
                        .foregroundStyle(theme.tertiaryLabelColor)
                }
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
        let providers = catalog.providers.filter { provider in
            (!restrictsProvider || provider.providerId == providerId)
                && !filteredModels(for: provider).isEmpty
        }

        return providers.enumerated()
            .sorted { left, right in
                let leftPriority = priority(for: left.element)
                let rightPriority = priority(for: right.element)
                return leftPriority == rightPriority
                    ? left.offset < right.offset
                    : leftPriority < rightPriority
            }
            .map(\.element)
    }

    private func priority(for provider: ProviderCatalogEntry) -> Int {
        if provider.providerId == selectedModel?.providerId {
            return 0
        }
        return provider.canSelectModels ? 1 : 2
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

private extension ProviderCatalogEntry {
    var canSelectModels: Bool {
        connected && !requiresReauth
    }
}
