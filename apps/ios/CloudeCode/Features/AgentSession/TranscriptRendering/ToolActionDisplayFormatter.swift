import Domain
import Foundation

enum ToolActionPhase: Sendable, Equatable {
    case pending
    case active
    case complete
}

struct ToolActionDisplay {
    let title: String
    let subtitle: String?
    let iconName: String
}

struct ToolActionDisplayFormatter {
    func display(
        for item: AgentSessionRenderItem.ActionItem,
        isActive: Bool
    ) -> ToolActionDisplay {
        switch item {
        case .single(let single):
            display(for: single.action, isActive: isActive)
        case .group(let group):
            display(for: group, isActive: isActive)
        }
    }

    func display(
        for action: NormalizedToolAction,
        isActive: Bool
    ) -> ToolActionDisplay {
        let phase = phase(for: action, isActive: isActive)
        return ToolActionDisplay(
            title: title(for: action, phase: phase),
            subtitle: subtitle(for: action),
            iconName: action.kind.iconName
        )
    }

    func display(
        for group: AgentSessionRenderItem.ActionGroup,
        isActive: Bool
    ) -> ToolActionDisplay {
        let phase = phase(for: group, isActive: isActive)
        return ToolActionDisplay(
            title: groupTitle(kind: group.kind, count: displayCount(for: group), phase: phase),
            subtitle: groupSubtitle(kind: group.kind),
            iconName: group.kind.iconName
        )
    }
}

private extension ToolActionDisplayFormatter {
    func title(
        for action: NormalizedToolAction,
        phase: ToolActionPhase
    ) -> String {
        switch action.payload {
        case .read, .edit, .write, .bash:
            fileCommandTitle(for: action)
        case .search, .web, .todo, .plan, .other:
            contextualTitle(for: action, phase: phase)
        }
    }

    func fileCommandTitle(for action: NormalizedToolAction) -> String {
        switch action.payload {
        case .read(let payload):
            readTitle(payload)
        case .edit(let payload):
            String(localized: "Edit \(payload.path)", comment: "Title for a file edit tool action")
        case .write(let payload):
            writeTitle(payload)
        case .bash(let payload):
            bashTitle(payload)
        case .search, .web, .todo, .plan, .other:
            action.toolName
        }
    }

    func contextualTitle(
        for action: NormalizedToolAction,
        phase: ToolActionPhase
    ) -> String {
        switch action.payload {
        case .search(let payload):
            searchTitle(payload)
        case .web(let payload):
            webTitle(payload)
        case .todo:
            todoTitle(phase: phase)
        case .plan:
            String(localized: "Plan", comment: "Title for a plan tool action")
        case .other(let payload):
            payload.toolName
        case .read, .edit, .write, .bash:
            action.toolName
        }
    }

    func readTitle(_ payload: NormalizedToolAction.ReadAction) -> String {
        String(localized: "Read \(payload.primaryPath)", comment: "Title for a file read tool action")
    }

    func writeTitle(_ payload: NormalizedToolAction.WriteAction) -> String {
        if payload.deleted {
            return String(localized: "Delete \(payload.path)", comment: "Title for a file delete tool action")
        }
        return String(localized: "Write \(payload.path)", comment: "Title for a file write tool action")
    }

    func bashTitle(_ payload: NormalizedToolAction.BashAction) -> String {
        if payload.command.isEmpty {
            return String(localized: "Run command", comment: "Title for an empty shell command tool action")
        }
        return payload.command
    }

    func searchTitle(_ payload: NormalizedToolAction.SearchAction) -> String {
        let pattern = payload.patterns.first ?? ""
        return String(localized: "Search \(pattern)", comment: "Title for a code search tool action")
    }

    func webTitle(_ payload: NormalizedToolAction.WebAction) -> String {
        if payload.kind == .fetch {
            return String(localized: "Fetch \(payload.url ?? "")", comment: "Title for a web fetch tool action")
        }
        return String(localized: "Search web", comment: "Title for a web search tool action")
    }

    func todoTitle(phase: ToolActionPhase) -> String {
        switch phase {
        case .pending:
            String(localized: "Update todos", comment: "Pending title for a todo update tool action")
        case .active:
            String(localized: "Updating todos", comment: "Active title for a todo update tool action")
        case .complete:
            String(localized: "Updated todos", comment: "Complete title for a todo update tool action")
        }
    }
}

private extension ToolActionDisplayFormatter {
    func subtitle(for action: NormalizedToolAction) -> String? {
        switch action.payload {
        case .read, .edit, .write, .bash:
            fileCommandSubtitle(for: action)
        case .search, .web, .todo, .plan, .other:
            contextualSubtitle(for: action)
        }
    }

    func fileCommandSubtitle(for action: NormalizedToolAction) -> String? {
        switch action.payload {
        case .read(let payload):
            readSubtitle(payload, state: action.state)
        case .edit:
            String(localized: "Diff available")
        case .write(let payload):
            writeSubtitle(payload)
        case .bash(let payload):
            payload.exitCode.map { String(localized: "Exit \($0)") }
        case .search, .web, .todo, .plan, .other:
            nil
        }
    }

    func contextualSubtitle(for action: NormalizedToolAction) -> String? {
        switch action.payload {
        case .search(let payload):
            payload.patterns.joined(separator: ", ")
        case .web(let payload):
            payload.url ?? payload.query ?? action.state
        case .todo:
            String(localized: "Todo details")
        case .plan:
            String(localized: "Plan details")
        case .other:
            String(localized: "Generic tool details")
        case .read, .edit, .write, .bash:
            nil
        }
    }

    func readSubtitle(
        _ payload: NormalizedToolAction.ReadAction,
        state: String
    ) -> String {
        if payload.content == nil {
            return state
        }
        return String(localized: "File preview available")
    }

    func writeSubtitle(_ payload: NormalizedToolAction.WriteAction) -> String {
        if payload.deleted {
            return String(localized: "Deleted file")
        }
        return String(localized: "File contents available")
    }

    func groupSubtitle(kind: ToolKind) -> String {
        switch kind {
        case .read:
            String(localized: "Tap to view each file")
        case .search:
            String(localized: "Tap to view each pattern")
        case .web:
            String(localized: "Tap to view each web request")
        case .bash:
            String(localized: "Tap to view each command")
        case .other:
            String(localized: "Tap to view each tool")
        case .edit, .write, .todo, .plan:
            String(localized: "Tap to view each action")
        }
    }
}

private extension ToolActionDisplayFormatter {
    func phase(
        for action: NormalizedToolAction,
        isActive: Bool
    ) -> ToolActionPhase {
        if isActive {
            return .active
        }
        if action.isComplete {
            return .complete
        }
        if action.isRunning {
            return .active
        }
        return .pending
    }

    func phase(
        for group: AgentSessionRenderItem.ActionGroup,
        isActive: Bool
    ) -> ToolActionPhase {
        if isActive {
            return .active
        }
        if group.actions.allSatisfy(\.isComplete) {
            return .complete
        }
        if group.actions.contains(where: \.isRunning) {
            return .active
        }
        return .pending
    }

    func displayCount(for group: AgentSessionRenderItem.ActionGroup) -> Int {
        switch group.kind {
        case .read:
            max(readPathCount(group.actions), group.actions.count)
        case .search:
            max(searchPatternCount(group.actions), group.actions.count)
        case .web, .bash, .other, .edit, .write, .todo, .plan:
            group.actions.count
        }
    }

    func readPathCount(_ actions: [NormalizedToolAction]) -> Int {
        actions.reduce(0) { result, action in
            guard case .read(let payload) = action.payload else {
                return result
            }
            return result + payload.paths.count
        }
    }

    func searchPatternCount(_ actions: [NormalizedToolAction]) -> Int {
        actions.reduce(0) { result, action in
            guard case .search(let payload) = action.payload else {
                return result
            }
            return result + payload.patterns.count
        }
    }
}
