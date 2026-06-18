import Domain
import Foundation

struct CountTitleTemplate {
    let singular: (Int) -> String
    let plural: (Int) -> String

    func title(count: Int) -> String {
        if count == 1 {
            return singular(count)
        }
        return plural(count)
    }
}

struct GroupTitleTemplates {
    let pending: CountTitleTemplate
    let active: CountTitleTemplate
    let complete: CountTitleTemplate

    func title(count: Int, phase: ToolActionPhase) -> String {
        switch phase {
        case .pending:
            pending.title(count: count)
        case .active:
            active.title(count: count)
        case .complete:
            complete.title(count: count)
        }
    }
}

extension ToolActionDisplayFormatter {
    func groupTitle(
        kind: ToolKind,
        count: Int,
        phase: ToolActionPhase
    ) -> String {
        templates(for: kind).title(count: count, phase: phase)
    }

    private func templates(for kind: ToolKind) -> GroupTitleTemplates {
        switch kind {
        case .read, .search, .web, .bash:
            fileSearchTemplates(for: kind)
        case .edit, .write, .todo, .plan, .other:
            actionTemplates(for: kind)
        }
    }

    private func fileSearchTemplates(for kind: ToolKind) -> GroupTitleTemplates {
        switch kind {
        case .read:
            readTemplates
        case .search:
            searchTemplates
        case .web:
            webTemplates
        case .bash:
            bashTemplates
        case .edit, .write, .todo, .plan, .other:
            otherTemplates
        }
    }

    private func actionTemplates(for kind: ToolKind) -> GroupTitleTemplates {
        switch kind {
        case .edit:
            editTemplates
        case .write:
            writeTemplates
        case .todo:
            todoTemplates
        case .plan:
            planTemplates
        case .other:
            otherTemplates
        case .read, .search, .web, .bash:
            otherTemplates
        }
    }
}

private extension ToolActionDisplayFormatter {
    var readTemplates: GroupTitleTemplates {
        GroupTitleTemplates(
            pending: .init(
                singular: { String(localized: "Read \($0) file") },
                plural: { String(localized: "Read \($0) files") }
            ),
            active: .init(
                singular: { String(localized: "Reading \($0) file") },
                plural: { String(localized: "Reading \($0) files") }
            ),
            complete: .init(
                singular: { String(localized: "Read \($0) file") },
                plural: { String(localized: "Read \($0) files") }
            )
        )
    }

    var searchTemplates: GroupTitleTemplates {
        GroupTitleTemplates(
            pending: .init(
                singular: { String(localized: "Search \($0) pattern") },
                plural: { String(localized: "Search \($0) patterns") }
            ),
            active: .init(
                singular: { String(localized: "Searching \($0) pattern") },
                plural: { String(localized: "Searching \($0) patterns") }
            ),
            complete: .init(
                singular: { String(localized: "Searched \($0) pattern") },
                plural: { String(localized: "Searched \($0) patterns") }
            )
        )
    }

    var webTemplates: GroupTitleTemplates {
        GroupTitleTemplates(
            pending: .init(
                singular: { String(localized: "Make \($0) web request") },
                plural: { String(localized: "Make \($0) web requests") }
            ),
            active: .init(
                singular: { String(localized: "Making \($0) web request") },
                plural: { String(localized: "Making \($0) web requests") }
            ),
            complete: .init(
                singular: { String(localized: "Made \($0) web request") },
                plural: { String(localized: "Made \($0) web requests") }
            )
        )
    }

    var bashTemplates: GroupTitleTemplates {
        GroupTitleTemplates(
            pending: .init(
                singular: { String(localized: "Run \($0) command") },
                plural: { String(localized: "Run \($0) commands") }
            ),
            active: .init(
                singular: { String(localized: "Running \($0) command") },
                plural: { String(localized: "Running \($0) commands") }
            ),
            complete: .init(
                singular: { String(localized: "Ran \($0) command") },
                plural: { String(localized: "Ran \($0) commands") }
            )
        )
    }
}

private extension ToolActionDisplayFormatter {
    var editTemplates: GroupTitleTemplates {
        let template = CountTitleTemplate(
            singular: { String(localized: "Edit \($0) action") },
            plural: { String(localized: "Edit \($0) actions") }
        )
        return GroupTitleTemplates(pending: template, active: template, complete: template)
    }

    var writeTemplates: GroupTitleTemplates {
        let template = CountTitleTemplate(
            singular: { String(localized: "Write \($0) action") },
            plural: { String(localized: "Write \($0) actions") }
        )
        return GroupTitleTemplates(pending: template, active: template, complete: template)
    }

    var todoTemplates: GroupTitleTemplates {
        let template = CountTitleTemplate(
            singular: { String(localized: "Update \($0) todo list") },
            plural: { String(localized: "Update \($0) todo lists") }
        )
        return GroupTitleTemplates(pending: template, active: template, complete: template)
    }

    var planTemplates: GroupTitleTemplates {
        let template = CountTitleTemplate(
            singular: { String(localized: "Plan \($0) update") },
            plural: { String(localized: "Plan \($0) updates") }
        )
        return GroupTitleTemplates(pending: template, active: template, complete: template)
    }

    var otherTemplates: GroupTitleTemplates {
        GroupTitleTemplates(
            pending: .init(
                singular: { String(localized: "Use \($0) tool") },
                plural: { String(localized: "Use \($0) tools") }
            ),
            active: .init(
                singular: { String(localized: "Using \($0) tool") },
                plural: { String(localized: "Using \($0) tools") }
            ),
            complete: .init(
                singular: { String(localized: "Used \($0) tool") },
                plural: { String(localized: "Used \($0) tools") }
            )
        )
    }
}
