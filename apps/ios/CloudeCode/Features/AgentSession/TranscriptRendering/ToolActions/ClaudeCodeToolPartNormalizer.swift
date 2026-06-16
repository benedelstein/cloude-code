import Domain

struct ClaudeCodeToolPartNormalizer: ToolPartNormalizer {
    // Provider tool names are the external dispatch surface for Claude Code.
    // swiftlint:disable:next cyclomatic_complexity
    func normalize(_ part: NormalizableToolPart) -> [NormalizedToolAction] {
        switch part.toolName {
        case "Read":
            return [read(part)]
        case "Edit":
            return [edit(part)]
        case "MultiEdit":
            return multiEdit(part)
        case "Write":
            return [write(part)]
        case "Bash":
            return [bash(part)]
        case "Grep", "Glob":
            return [search(part)]
        case "WebFetch":
            return [webFetch(part)]
        case "WebSearch":
            return [webSearch(part)]
        case "TodoWrite":
            return [todo(part, todos: inputObject(part)["todos"])]
        case "TaskCreate", "TaskUpdate":
            return [todo(part, todos: .array([taskTodo(inputObject(part))]))]
        case "TaskList":
            return [todo(
                part,
                todos: taskListTodos(part.output) ?? taskListTodos(inputObject(part)["tasks"]) ?? .array([])
            )]
        case "TaskGet":
            return [todo(part, todos: taskListTodos(part.output) ?? .array([taskTodo(inputObject(part))]))]
        case "ExitPlanMode":
            return [plan(part)]
        default:
            return [.other(from: part)]
        }
    }

    private func read(_ part: NormalizableToolPart) -> NormalizedToolAction {
        let input = inputObject(part)
        let path = input.string("file_path")
        return NormalizedToolAction(
            toolPart: part,
            payload: .read(.init(
                paths: path.isEmpty ? [] : [path],
                lineRange: readLineRange(input),
                content: part.output?.stringValue
            ))
        )
    }

    private func edit(_ part: NormalizableToolPart) -> NormalizedToolAction {
        let input = inputObject(part)
        return NormalizedToolAction(
            toolPart: part,
            payload: .edit(.init(
                path: input.string("file_path"),
                diff: lineDiff(oldString: input.string("old_string"), newString: input.string("new_string"))
            ))
        )
    }

    private func multiEdit(_ part: NormalizableToolPart) -> [NormalizedToolAction] {
        let input = inputObject(part)
        let path = input.string("file_path")
        let edits = input.array("edits") ?? []
        guard !edits.isEmpty else {
            return [NormalizedToolAction(toolPart: part, payload: .edit(.init(path: path, diff: "")))]
        }

        return edits.map { editValue in
            let edit = editValue.objectValue ?? [:]
            return NormalizedToolAction(
                toolPart: part,
                payload: .edit(.init(
                    path: path,
                    diff: lineDiff(oldString: edit.string("old_string"), newString: edit.string("new_string"))
                ))
            )
        }
    }

    private func write(_ part: NormalizableToolPart) -> NormalizedToolAction {
        let input = inputObject(part)
        let content = input.string("content")
        return NormalizedToolAction(
            toolPart: part,
            payload: .write(.init(
                path: input.string("file_path"),
                content: content.isEmpty ? nil : content,
                isNew: true,
                deleted: false
            ))
        )
    }

    private func bash(_ part: NormalizableToolPart) -> NormalizedToolAction {
        NormalizedToolAction(
            toolPart: part,
            payload: .bash(.init(
                command: inputObject(part).string("command"),
                output: part.output?.stringValue,
                exitCode: nil,
                status: nil
            ))
        )
    }

    private func search(_ part: NormalizableToolPart) -> NormalizedToolAction {
        let pattern = inputObject(part).string("pattern")
        return NormalizedToolAction(
            toolPart: part,
            payload: .search(.init(patterns: pattern.isEmpty ? [] : [pattern]))
        )
    }

    private func webFetch(_ part: NormalizableToolPart) -> NormalizedToolAction {
        let url = inputObject(part).string("url")
        return NormalizedToolAction(
            toolPart: part,
            payload: .web(.init(kind: .fetch, url: url.isEmpty ? nil : url, query: nil))
        )
    }

    private func webSearch(_ part: NormalizableToolPart) -> NormalizedToolAction {
        let query = inputObject(part).string("query")
        return NormalizedToolAction(
            toolPart: part,
            payload: .web(.init(kind: .search, url: nil, query: query.isEmpty ? nil : query))
        )
    }

    private func todo(_ part: NormalizableToolPart, todos: JSONValue?) -> NormalizedToolAction {
        NormalizedToolAction(toolPart: part, payload: .todo(.init(todos: todos)))
    }

    private func plan(_ part: NormalizableToolPart) -> NormalizedToolAction {
        NormalizedToolAction(
            toolPart: part,
            payload: .plan(.init(plan: inputObject(part).string("plan")))
        )
    }

    private func inputObject(_ part: NormalizableToolPart) -> [String: JSONValue] {
        part.input?.objectValue ?? [:]
    }

    private func readLineRange(_ input: [String: JSONValue]) -> NormalizedToolAction.LineRange? {
        let offset = positiveInteger(input["offset"])
        let limit = positiveInteger(input["limit"])
        guard offset != nil || limit != nil else {
            return nil
        }

        let start = offset ?? 1
        return .init(start: start, end: limit.map { start + $0 - 1 })
    }

    private func positiveInteger(_ value: JSONValue?) -> Int? {
        guard let intValue = value?.intValue, intValue > 0 else {
            return nil
        }
        return intValue
    }

    private func taskListTodos(_ value: JSONValue?) -> JSONValue? {
        guard let value else {
            return nil
        }

        if let array = value.arrayValue {
            return .array(array.map { item in
                guard let object = item.objectValue else {
                    return item
                }
                return taskTodo(object)
            })
        }

        guard let object = value.objectValue else {
            return nil
        }

        if let tasks = object["tasks"] ?? object["todos"], let todos = taskListTodos(tasks) {
            return todos
        }

        if object["subject"] != nil || object["content"] != nil || object["taskId"] != nil || object["id"] != nil {
            return .array([taskTodo(object)])
        }

        return nil
    }

    private func taskTodo(_ input: [String: JSONValue]) -> JSONValue {
        let id = input["taskId"]?.stringValue ?? input["id"]?.stringValue
        let subject = input.string("subject")
        let content = subject.isEmpty ? input.string("content") : subject
        let fallbackContent = id.map { "Task #\($0)" } ?? "Task"
        var object: [String: JSONValue] = [
            "content": .string(content.isEmpty ? fallbackContent : content),
            "status": .string(taskStatus(input["status"]?.stringValue))
        ]

        if let id, !id.isEmpty {
            object["id"] = .string(id)
        }

        let activeForm = input.string("activeForm")
        if !activeForm.isEmpty {
            object["activeForm"] = .string(activeForm)
        }

        return .object(object)
    }

    private func taskStatus(_ value: String?) -> String {
        switch value {
        case "pending", "in_progress", "completed":
            value ?? "pending"
        default:
            "pending"
        }
    }
}
