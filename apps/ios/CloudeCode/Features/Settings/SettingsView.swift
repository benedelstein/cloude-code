import Domain
import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    let logStore: AppLogStore

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        LogsView(logStore: logStore)
                    } label: {
                        Label("Logs", systemImage: "doc.text.magnifyingglass")
                    }
                } header: {
                    Text("Diagnostics")
                } footer: {
                    Text("Recent app logs are kept in memory for TestFlight debugging.")
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarCloseButton {
                    dismiss()
                }
            }
        }
    }
}

private struct LogsView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let logStore: AppLogStore

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: style.gridSize) {
                if logStore.entries.isEmpty {
                    ContentUnavailableView(
                        "No logs yet",
                        systemImage: "doc.text"
                    )
                    .frame(maxWidth: .infinity, minHeight: style.gridSize * 24)
                } else {
                    ForEach(logStore.entries) { entry in
                        LogRow(entry: entry)
                    }
                }
            }
            .padding(style.horizontalPadding)
        }
        .background(theme.backgroundColor)
        .navigationTitle("Logs")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Copy") {
                    UIPasteboard.general.string = logStore.exportText
                }
                .disabled(logStore.entries.isEmpty)
            }
        }
    }
}

private struct LogRow: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let entry: AppLogRecord

    var body: some View {
        VStack(alignment: .leading, spacing: style.gridSize / 2) {
            HStack(spacing: style.gridSize) {
                Text(entry.level.rawValue)
                    .font(style.captionFont.weight(.semibold))
                    .foregroundStyle(levelColor)

                Text(entry.displayTime)
                    .styledFont(.caption)
                    .foregroundStyle(theme.secondaryLabelColor)

                Spacer(minLength: style.gridSize)
            }

            Text(entry.message)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(theme.labelColor)
//                .textSelection(.enabled)

            Text(entry.location)
                .styledFont(.caption)
                .foregroundStyle(theme.secondaryLabelColor)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(style.gridSize)
        .background(theme.secondaryBackgroundColor)
        .clipShape(RoundedRectangle(cornerRadius: style.gridSize, style: .continuous))
    }

    private var levelColor: Color {
        switch entry.level {
        case .debug:
            theme.secondaryLabelColor
        case .info:
            theme.accentBlue
        case .warning:
            .orange
        case .error:
            theme.errorRed
        }
    }
}
