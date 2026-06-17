import Domain
import SwiftUI

struct AgentSessionRenderItemView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let item: AgentSessionRenderItem
    let openDetails: () -> Void

    var body: some View {
        switch item {
        case .text(let item):
            MarkdownText(text: item.text)
                .styledFont(.subheadline)
                .foregroundStyle(theme.labelColor)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .reasoning(let item):
            VStack(alignment: .leading, spacing: style.gridSize / 2) {
                Label("Reasoning", systemImage: "brain")
                    .styledFont(.caption)
                    .foregroundStyle(theme.secondaryLabelColor)
                MarkdownText(text: item.part.text)
                    .styledFont(.footnote)
                    .foregroundStyle(theme.secondaryLabelColor)
                    .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .actionItem(let item):
            Button(action: openDetails) {
                ToolActionInlineRow(item: item)
            }
            .buttonStyle(.plain)
        }
    }
}

private struct ToolActionInlineRow: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let item: AgentSessionRenderItem.ActionItem

    var body: some View {
        HStack(spacing: style.gridSize) {
            Image(systemName: item.iconName)
                .font(style.calloutFont)
                .foregroundStyle(theme.accentBlue)
                .frame(width: style.gridSize * 3, height: style.gridSize * 3)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .styledFont(.subheadline)
                    .foregroundStyle(theme.labelColor)
                    .lineLimit(1)
                Text(item.subtitle)
                    .styledFont(.caption)
                    .foregroundStyle(theme.secondaryLabelColor)
                    .lineLimit(1)
            }

            Spacer(minLength: style.gridSize)

            Image(systemName: "chevron.right")
                .font(style.captionFont)
                .foregroundStyle(theme.tertiaryLabelColor)
        }
        .padding(.horizontal, style.gridSize * 1.5)
        .padding(.vertical, style.gridSize)
        .background(
            RoundedRectangle(cornerRadius: style.gridSize)
                .fill(theme.secondaryBackgroundColor)
        )
        .contentShape(RoundedRectangle(cornerRadius: style.gridSize))
    }
}

private extension AgentSessionRenderItem.ActionItem {
    var title: String {
        switch self {
        case .single(let single):
            single.action.title
        case .group(let group):
            "\(group.kind.groupTitle) \(group.actions.count) \(group.kind.groupNoun(count: group.actions.count))"
        }
    }

    var subtitle: String {
        switch self {
        case .single(let single):
            single.action.subtitle
        case .group(let group):
            "Tap to view each \(group.kind.groupNoun(count: 1))"
        }
    }

    var iconName: String {
        switch self {
        case .single(let single):
            single.action.kind.iconName
        case .group(let group):
            group.kind.iconName
        }
    }
}

extension NormalizedToolAction {
    var title: String {
        switch payload {
        case .read(let payload):
            "Read \(payload.primaryPath)"
        case .edit(let payload):
            "Edit \(payload.path)"
        case .write(let payload):
            payload.deleted ? "Delete \(payload.path)" : "Write \(payload.path)"
        case .bash(let payload):
            payload.command.isEmpty ? "Run command" : payload.command
        case .search(let payload):
            "Search \(payload.patterns.first ?? "")"
        case .web(let payload):
            payload.kind == .fetch ? "Fetch \(payload.url ?? "")" : "Search web"
        case .todo:
            "Update todos"
        case .plan:
            "Plan"
        case .other(let payload):
            payload.toolName
        }
    }

    var subtitle: String {
        switch payload {
        case .read(let payload):
            payload.content == nil ? state : "File preview available"
        case .edit:
            "Diff available"
        case .write(let payload):
            payload.deleted ? "Deleted file" : "File contents available"
        case .bash(let payload):
            payload.exitCode.map { "Exit \($0)" } ?? state
        case .search(let payload):
            payload.patterns.joined(separator: ", ")
        case .web(let payload):
            payload.url ?? payload.query ?? state
        case .todo:
            "Todo details"
        case .plan:
            "Plan details"
        case .other:
            "Generic tool details"
        }
    }
}

private extension NormalizedToolAction.ReadAction {
    var primaryPath: String {
        paths.first ?? "file"
    }
}

extension ToolKind {
    var iconName: String {
        switch self {
        case .read:
            "doc.text.magnifyingglass"
        case .edit:
            "square.and.pencil"
        case .write:
            "doc.badge.plus"
        case .bash:
            "terminal"
        case .search:
            "magnifyingglass"
        case .web:
            "globe"
        case .todo:
            "checklist"
        case .plan:
            "list.bullet.rectangle"
        case .other:
            "wrench.and.screwdriver"
        }
    }

    var groupTitle: String {
        switch self {
        case .read:
            "Read"
        case .search:
            "Search"
        case .web:
            "Web"
        case .bash:
            "Run"
        case .other:
            "Use"
        case .edit, .write, .todo, .plan:
            rawValue.capitalized
        }
    }

    func groupNoun(count: Int) -> String {
        switch self {
        case .read:
            count == 1 ? "file" : "files"
        case .search:
            count == 1 ? "search" : "searches"
        case .web:
            count == 1 ? "request" : "requests"
        case .bash:
            count == 1 ? "command" : "commands"
        case .other:
            count == 1 ? "tool" : "tools"
        case .edit, .write, .todo, .plan:
            count == 1 ? "action" : "actions"
        }
    }
}
