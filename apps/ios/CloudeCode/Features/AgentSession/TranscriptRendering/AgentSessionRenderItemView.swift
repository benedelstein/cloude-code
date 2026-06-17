import Domain
import SwiftUI

struct AgentSessionRenderItemView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let item: AgentSessionRenderItem
    let isActive: Bool
    let openDetails: () -> Void

    init(
        item: AgentSessionRenderItem,
        isActive: Bool = false,
        openDetails: @escaping () -> Void
    ) {
        self.item = item
        self.isActive = isActive
        self.openDetails = openDetails
    }

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
                Label("Thinking", systemImage: "brain")
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
                ToolActionInlineRow(item: item, isActive: isActive)
            }
            .buttonStyle(.plain)
        }
    }
}

private struct ToolActionInlineRow: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let item: AgentSessionRenderItem.ActionItem
    let isActive: Bool

    var body: some View {
        HStack(spacing: style.gridSize) {
            Image(systemName: item.iconName)
                .font(style.caption2Font)
                .foregroundStyle(theme.accentBlue)
                .frame(width: 14)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title(isActive: isActive))
                    .styledFont(.subheadline)
                    .foregroundStyle(theme.labelColor)
                    .lineLimit(1)
            }

            Image(systemName: "chevron.right")
                .font(style.caption2Font)
                .foregroundStyle(theme.tertiaryLabelColor)
        }
        .contentShape(RoundedRectangle(cornerRadius: style.gridSize))
    }
}

extension AgentSessionRenderItem.ActionItem {
    func title(isActive: Bool = false) -> String {
        switch self {
        case .single(let single):
            single.action.title(isActive: isActive)
        case .group(let group):
            group.title(isActive: isActive)
        }
    }

    var subtitle: String? {
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

extension AgentSessionRenderItem.ActionGroup {
    func title(isActive: Bool = false) -> String {
        kind.groupTitle(count: displayCount, phase: phase(isActive: isActive))
    }

    private var displayCount: Int {
        switch kind {
        case .read:
            let pathCount = actions.reduce(0) { result, action in
                guard case .read(let payload) = action.payload else {
                    return result
                }
                return result + payload.paths.count
            }
            return max(pathCount, actions.count)
        case .search:
            let patternCount = actions.reduce(0) { result, action in
                guard case .search(let payload) = action.payload else {
                    return result
                }
                return result + payload.patterns.count
            }
            return max(patternCount, actions.count)
        case .web, .bash, .other, .edit, .write, .todo, .plan:
            return actions.count
        }
    }

    private func phase(isActive: Bool) -> ToolActionPhase {
        if isActive {
            return .active
        }
        if actions.allSatisfy(\.isComplete) {
            return .complete
        }
        if actions.contains(where: \.isRunning) {
            return .active
        }
        return .pending
    }
}

enum ToolActionPhase: Sendable, Equatable {
    case pending
    case active
    case complete
}

private struct ToolKindGroupVerbs {
    let pending: String
    let active: String
    let complete: String
}

extension NormalizedToolAction {
    var isComplete: Bool {
        switch state {
        case "output-available", "output-error":
            true
        default:
            false
        }
    }

    var isRunning: Bool {
        switch state {
        case "input-available":
            true
        default:
            false
        }
    }

    func title(isActive: Bool = false) -> String {
        fileSystemTitle ?? commandTitle(isActive: isActive)
    }

    private var fileSystemTitle: String? {
        switch payload {
        case .read(let payload):
            "Read \(payload.primaryPath)"
        case .edit(let payload):
            "Edit \(payload.path)"
        case .write(let payload):
            payload.deleted ? "Delete \(payload.path)" : "Write \(payload.path)"
        case .bash(let payload):
            payload.command.isEmpty ? "Run command" : payload.command
        case .search, .web, .todo, .plan, .other:
            nil
        }
    }

    private func commandTitle(isActive: Bool) -> String {
        switch payload {
        case .search(let payload):
            "Search \(payload.patterns.first ?? "")"
        case .web(let payload):
            payload.kind == .fetch ? "Fetch \(payload.url ?? "")" : "Search web"
        case .todo:
            todoTitle(isActive: isActive)
        case .plan:
            "Plan"
        case .other(let payload):
            payload.toolName
        case .read, .edit, .write, .bash:
            ""
        }
    }

    private func todoTitle(isActive: Bool) -> String {
        switch phase(isActive: isActive) {
        case .pending:
            "Update todos"
        case .active:
            "Updating todos"
        case .complete:
            "Updated todos"
        }
    }

    private func phase(isActive: Bool) -> ToolActionPhase {
        if isActive {
            return .active
        }
        if isComplete {
            return .complete
        }
        if isRunning {
            return .active
        }
        return .pending
    }

    var subtitle: String? {
        switch payload {
        case .read(let payload):
            payload.content == nil ? state : "File preview available"
        case .edit:
            "Diff available"
        case .write(let payload):
            payload.deleted ? "Deleted file" : "File contents available"
        case .bash(let payload):
            payload.exitCode.map { "Exit \($0)" }
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

    func groupTitle(count: Int, phase: ToolActionPhase) -> String {
        "\(groupVerb(for: phase)) \(count) \(groupNoun(count: count))"
    }

    private func groupVerb(for phase: ToolActionPhase) -> String {
        let verbs = groupVerbs
        switch phase {
        case .pending:
            return verbs.pending
        case .active:
            return verbs.active
        case .complete:
            return verbs.complete
        }
    }

    private var groupVerbs: ToolKindGroupVerbs {
        switch self {
        case .read:
            ToolKindGroupVerbs(pending: "Read", active: "Reading", complete: "Read")
        case .search:
            ToolKindGroupVerbs(pending: "Search", active: "Searching", complete: "Searched")
        case .web:
            ToolKindGroupVerbs(pending: "Make", active: "Making", complete: "Made")
        case .bash:
            ToolKindGroupVerbs(pending: "Run", active: "Running", complete: "Ran")
        case .other:
            ToolKindGroupVerbs(pending: "Use", active: "Using", complete: "Used")
        case .edit, .write, .todo, .plan:
            ToolKindGroupVerbs(
                pending: rawValue.capitalized,
                active: rawValue.capitalized,
                complete: rawValue.capitalized
            )
        }
    }

    func groupNoun(count: Int) -> String {
        switch self {
        case .read:
            count == 1 ? "file" : "files"
        case .search:
            count == 1 ? "pattern" : "patterns"
        case .web:
            count == 1 ? "web request" : "web requests"
        case .bash:
            count == 1 ? "command" : "commands"
        case .other:
            count == 1 ? "tool" : "tools"
        case .edit, .write, .todo, .plan:
            count == 1 ? "action" : "actions"
        }
    }
}
