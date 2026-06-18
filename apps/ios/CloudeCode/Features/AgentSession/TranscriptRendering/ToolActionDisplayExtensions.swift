import Domain
import Foundation

extension AgentSessionRenderItem.ActionItem {
    func title(isActive: Bool = false) -> String {
        ToolActionDisplayFormatter().display(for: self, isActive: isActive).title
    }

    var subtitle: String? {
        ToolActionDisplayFormatter().display(for: self, isActive: false).subtitle
    }

    var iconName: String {
        ToolActionDisplayFormatter().display(for: self, isActive: false).iconName
    }
}

extension AgentSessionRenderItem.ActionGroup {
    func title(isActive: Bool = false) -> String {
        ToolActionDisplayFormatter().display(for: self, isActive: isActive).title
    }
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
        ToolActionDisplayFormatter().display(for: self, isActive: isActive).title
    }

    var subtitle: String? {
        ToolActionDisplayFormatter().display(for: self, isActive: false).subtitle
    }
}

extension NormalizedToolAction.ReadAction {
    var primaryPath: String {
        paths.first ?? String(localized: "File")
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
}
