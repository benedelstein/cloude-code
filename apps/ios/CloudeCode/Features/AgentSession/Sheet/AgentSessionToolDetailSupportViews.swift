import Domain
import Foundation
import SwiftUI
import UIKit

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
    @Environment(\.showToast) private var showToast
    @Environment(\.lightFeedback) private var lightFeedback

    let text: String

    var body: some View {
        ZStack(alignment: .topTrailing) {
            codeContent

            Button(action: copyText) {
                Image(systemName: "square.on.square")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(theme.secondaryLabelColor)
                    .padding(6)
                    .contentShape(Rectangle())
                    .background(
                        RoundedRectangle(cornerRadius: 6).fill(theme.secondaryBackgroundColor)
                    )
            }
            .accessibilityLabel("Copy")
            .padding(style.gridSize / 2)
        }
        .background(
            RoundedRectangle(cornerRadius: style.gridSize)
                .fill(theme.backgroundColor)
        )
        .clipShape(RoundedRectangle(cornerRadius: style.gridSize))
    }

    private var codeContent: some View {
        HStack(alignment: .top, spacing: 0) {
            if hasLineNumbers {
                lineNumberGutter
            }

            ScrollView(.horizontal, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(lines.indices, id: \.self) { index in
                        codeLine(lines[index].content)
                    }
                }
                .padding(.vertical, style.gridSize)
                .padding(.leading, style.gridSize)
                .padding(.trailing, style.gridSize * 5)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var lineNumberGutter: some View {
        VStack(alignment: .trailing, spacing: 0) {
            ForEach(lines.indices, id: \.self) { index in
                codeLine(lines[index].lineNumber ?? "")
                    .foregroundStyle(theme.tertiaryLabelColor)
                    .frame(minWidth: lineNumberWidth, alignment: .trailing)
            }
        }
        .padding(.vertical, style.gridSize)
        .padding(.leading, style.gridSize)
        .padding(.trailing, style.gridSize)
        .background(theme.backgroundColor)
    }

    private func codeLine(_ value: String) -> some View {
        Text(verbatim: value.isEmpty ? " " : value)
            .font(.system(.footnote, design: .monospaced))
            .foregroundStyle(theme.labelColor)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
    }

    private func copyText() {
        UIPasteboard.general.string = text
        lightFeedback.impactOccurred()
        showToast?(verbatimTitle: "Copied", icon: Image(systemName: "doc.on.doc"))
    }

    private var lines: [CodePreviewLine] {
        CodePreviewLine.lines(from: text)
    }

    private var hasLineNumbers: Bool {
        lines.contains { $0.lineNumber != nil }
    }

    private var lineNumberWidth: CGFloat {
        CGFloat(lines.compactMap(\.lineNumber).map(\.count).max() ?? 1) * 8
    }
}

private struct CodePreviewLine: Equatable {
    let lineNumber: String?
    let content: String

    static func lines(from text: String) -> [CodePreviewLine] {
        let rawLines = text.split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
        let parsedLines = rawLines.map(parseLineNumber)
        let numberedLineCount = parsedLines.filter { $0.lineNumber != nil }.count
        let shouldShowGutter = numberedLineCount > 1
            && parsedLines.allSatisfy { line in
                line.lineNumber != nil || line.content.isEmpty
            }
        return shouldShowGutter
            ? parsedLines
            : rawLines.map { CodePreviewLine(lineNumber: nil, content: $0) }
    }

    private static func parseLineNumber(_ line: String) -> CodePreviewLine {
        let trimmedLeading = line.drop(while: \.isWhitespace)
        let digits = trimmedLeading.prefix(while: \.isNumber)
        guard !digits.isEmpty else {
            return CodePreviewLine(lineNumber: nil, content: line)
        }

        let remaining = trimmedLeading.dropFirst(digits.count)
        guard remaining.first?.isWhitespace == true else {
            return CodePreviewLine(lineNumber: nil, content: line)
        }

        return CodePreviewLine(
            lineNumber: String(digits),
            content: String(remaining.drop(while: \.isWhitespace))
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
//                    .textSelection(.enabled)
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
