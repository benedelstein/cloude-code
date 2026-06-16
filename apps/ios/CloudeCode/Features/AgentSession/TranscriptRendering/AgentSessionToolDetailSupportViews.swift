import Domain
import Foundation
import SwiftUI

struct DetailSection<Content: View>: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: style.gridSize) {
            Text(title)
                .styledFont(.caption)
                .foregroundStyle(theme.secondaryLabelColor)
                .textCase(.uppercase)
            content
                .styledFont(.subheadline)
                .foregroundStyle(theme.labelColor)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct CodePreview: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let text: String

    var body: some View {
        ScrollView(.horizontal) {
            Text(verbatim: text)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(theme.labelColor)
                .textSelection(.enabled)
                .padding(style.gridSize)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(
            RoundedRectangle(cornerRadius: style.gridSize)
                .fill(theme.secondaryBackgroundColor)
        )
    }
}

struct ValueList: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let values: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: style.gridSize / 2) {
            ForEach(displayValues, id: \.self) { value in
                Text(value)
                    .font(.system(.subheadline, design: .monospaced))
                    .foregroundStyle(theme.labelColor)
                    .textSelection(.enabled)
            }
        }
    }

    private var displayValues: [String] {
        values.isEmpty ? ["No details available"] : values
    }
}

extension AgentSessionRenderItem {
    var groupActions: [NormalizedToolAction] {
        guard case .actionItem(.group(let group)) = self else {
            return []
        }
        return group.actions
    }
}

extension NormalizedToolAction.LineRange {
    var displayValue: String {
        if let end {
            return "\(start)-\(end)"
        }
        return "\(start)"
    }
}

extension JSONValue? {
    var prettyPrintedJSON: String {
        guard let self else {
            return "No details available"
        }

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(self), let string = String(data: data, encoding: .utf8) else {
            return "Unable to render JSON"
        }
        return string
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        guard indices.contains(index) else {
            return nil
        }
        return self[index]
    }
}
