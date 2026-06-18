import Domain

struct OpenAICodexToolPartNormalizer: ToolPartNormalizer {
    func normalize(_ part: NormalizableToolPart) -> [NormalizedToolAction] {
        let input = inputObject(part)
        let inputType = input.string("type")

        switch (part.toolName, inputType) {
        case ("exec", _), (_, "commandExecution"):
            return [commandExecution(part)]
        case ("patch", _), (_, "fileChange"):
            return fileChanges(part)
        case ("web_search", _), (_, "webSearch"):
            return [webSearch(part)]
        case ("update_plan", _):
            return [NormalizedToolAction(
                toolPart: part,
                payload: .todo(.init(todos: input["plan"] ?? input["steps"]))
            )]
        default:
            return [.other(from: part)]
        }
    }

    private func commandExecution(_ part: NormalizableToolPart) -> NormalizedToolAction {
        let input = inputObject(part)
        let output = part.output?.objectValue ?? [:]
        return NormalizedToolAction(
            toolPart: part,
            payload: .bash(.init(
                command: input.string("command"),
                output: output["aggregatedOutput"]?.stringValue,
                exitCode: output["exitCode"]?.intValue,
                status: nil
            ))
        )
    }

    private func webSearch(_ part: NormalizableToolPart) -> NormalizedToolAction {
        let input = inputObject(part)
        let outputAction = part.output?.objectValue?["action"]?.objectValue
        let query = input.string("query").nilIfEmpty
            ?? outputAction?.string("query").nilIfEmpty
            ?? outputAction?.array("queries")?.first?.stringValue?.nilIfEmpty

        return NormalizedToolAction(
            toolPart: part,
            payload: .web(.init(kind: .search, url: nil, query: query))
        )
    }

    private func fileChanges(_ part: NormalizableToolPart) -> [NormalizedToolAction] {
        let changes = inputObject(part).array("changes") ?? []
        guard !changes.isEmpty else {
            return [.other(from: part)]
        }

        return changes.map { changeValue in
            let change = changeValue.objectValue ?? [:]
            return changeToAction(change, part: part)
        }
    }

    private func changeToAction(
        _ change: [String: JSONValue],
        part: NormalizableToolPart
    ) -> NormalizedToolAction {
        let path = change.string("path")
        let kindType = change.object("kind")?.string("type") ?? ""

        switch kindType {
        case "add":
            return NormalizedToolAction(
                toolPart: part,
                payload: .write(.init(
                    path: path,
                    content: change.string("content").isEmpty ? nil : change.string("content"),
                    isNew: true,
                    deleted: false
                ))
            )
        case "delete":
            return NormalizedToolAction(
                toolPart: part,
                payload: .write(.init(path: path, content: nil, isNew: false, deleted: true))
            )
        default:
            return NormalizedToolAction(
                toolPart: part,
                payload: .edit(.init(path: path, diff: change.string("diff")))
            )
        }
    }

    private func inputObject(_ part: NormalizableToolPart) -> [String: JSONValue] {
        part.input?.objectValue ?? [:]
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
