@testable import CloudeCode
import Domain
import Testing

@Suite("Agent session tool normalization")
struct AgentSessionToolNormalizationTests {
    @Test func claudeReadNormalizes() {
        let read = ClaudeCodeToolPartNormalizer().normalize(part(
            "Read",
            input: [
                "file_path": .string("/x/y.swift"),
                "offset": .number(1),
                "limit": .number(3)
            ],
            output: .string("hello")
        ))

        #expect(read.first?.kind == .read)
        if case .read(let payload) = read.first?.payload {
            #expect(payload.paths == ["/x/y.swift"])
            #expect(payload.lineRange == .init(start: 1, end: 3))
            #expect(payload.content == "hello")
        } else {
            Issue.record("Expected read payload")
        }
    }

    @Test func claudeEditAndWriteNormalize() {
        let edit = ClaudeCodeToolPartNormalizer().normalize(part(
            "Edit",
            input: [
                "file_path": .string("/x/y.swift"),
                "old_string": .string("foo"),
                "new_string": .string("bar")
            ]
        ))
        let write = ClaudeCodeToolPartNormalizer().normalize(part(
            "Write",
            input: [
                "file_path": .string("/new.swift"),
                "content": .string("let value = 1")
            ]
        ))

        #expect(edit.first?.kind == .edit)
        if case .edit(let payload) = edit.first?.payload {
            #expect(payload.path == "/x/y.swift")
            #expect(payload.diff.contains("-foo"))
            #expect(payload.diff.contains("+bar"))
        } else {
            Issue.record("Expected edit payload")
        }

        #expect(write.first?.kind == .write)
        if case .write(let payload) = write.first?.payload {
            #expect(payload.path == "/new.swift")
            #expect(payload.content == "let value = 1")
            #expect(payload.isNew)
            #expect(!payload.deleted)
        } else {
            Issue.record("Expected write payload")
        }
    }

    @Test func claudeCommandSearchAndWebNormalize() {
        let bash = ClaudeCodeToolPartNormalizer().normalize(part(
            "Bash",
            input: ["command": .string("ls")],
            output: .string("file.txt")
        ))
        let search = ClaudeCodeToolPartNormalizer().normalize(part("Grep", input: ["pattern": .string("TODO")]))
        let web = ClaudeCodeToolPartNormalizer().normalize(part(
            "WebSearch",
            input: ["query": .string("swift concurrency")]
        ))

        #expect(bash.first?.kind == .bash)
        if case .bash(let payload) = bash.first?.payload {
            #expect(payload.command == "ls")
            #expect(payload.output == "file.txt")
        } else {
            Issue.record("Expected bash payload")
        }

        #expect(search.first?.kind == .search)
        #expect(web.first?.kind == .web)
    }

    @Test func claudeTodoPlanAndFallbackNormalize() {
        let todo = ClaudeCodeToolPartNormalizer().normalize(part(
            "TaskCreate",
            input: [
                "subject": .string("Inspect bug"),
                "activeForm": .string("Inspecting bug")
            ]
        ))
        let plan = ClaudeCodeToolPartNormalizer().normalize(part(
            "ExitPlanMode",
            input: ["plan": .string("## Plan\n- Step")]
        ))
        let fallback = ClaudeCodeToolPartNormalizer().normalize(part("UnknownTool", input: ["value": .bool(true)]))

        #expect(todo.first?.kind == .todo)
        if case .todo(let payload) = todo.first?.payload {
            #expect(payload.todos == .array([
                .object([
                    "activeForm": .string("Inspecting bug"),
                    "content": .string("Inspect bug"),
                    "status": .string("pending")
                ])
            ]))
        } else {
            Issue.record("Expected todo payload")
        }

        #expect(plan.first?.kind == .plan)
        #expect(fallback.first?.kind == .other)
    }

    @Test func claudeMultiEditFansOut() {
        let actions = ClaudeCodeToolPartNormalizer().normalize(part(
            "MultiEdit",
            input: [
                "file_path": .string("/x.swift"),
                "edits": .array([
                    .object(["old_string": .string("a"), "new_string": .string("b")]),
                    .object(["old_string": .string("c"), "new_string": .string("d")])
                ])
            ]
        ))

        #expect(actions.count == 2)
        #expect(actions.allSatisfy { $0.kind == .edit })
    }

    @Test func codexCommandNormalizes() {
        let exec = OpenAICodexToolPartNormalizer().normalize(part(
            "exec",
            input: [
                "type": .string("commandExecution"),
                "command": .string("ls")
            ],
            output: .object([
                "aggregatedOutput": .string("file.txt"),
                "exitCode": .number(0)
            ])
        ))

        #expect(exec.first?.kind == .bash)
        if case .bash(let payload) = exec.first?.payload {
            #expect(payload.command == "ls")
            #expect(payload.output == "file.txt")
            #expect(payload.exitCode == 0)
        } else {
            Issue.record("Expected bash payload")
        }
    }

    @Test func codexWebSearchNormalizes() {
        let actions = OpenAICodexToolPartNormalizer().normalize(part(
            "web_search",
            input: [
                "type": .string("webSearch"),
                "query": .string("")
            ],
            output: .object([
                "action": .object([
                    "type": .string("search"),
                    "query": .string("Microsoft Teams bot outgoing webhook"),
                    "queries": .array([
                        .string("Microsoft Teams bot outgoing webhook")
                    ])
                ])
            ])
        ))

        #expect(actions.first?.kind == .web)
        if case .web(let payload) = actions.first?.payload {
            #expect(payload.kind == .search)
            #expect(payload.query == "Microsoft Teams bot outgoing webhook")
        } else {
            Issue.record("Expected web payload")
        }
    }

    @Test func codexPatchPlanAndFallbackNormalize() {
        let patch = OpenAICodexToolPartNormalizer().normalize(part(
            "patch",
            input: [
                "type": .string("fileChange"),
                "changes": .array([
                    .object([
                        "path": .string("/a.swift"),
                        "kind": .object(["type": .string("update")]),
                        "diff": .string("@@ ...")
                    ]),
                    .object([
                        "path": .string("/b.swift"),
                        "kind": .object(["type": .string("add")]),
                        "content": .string("hello")
                    ])
                ])
            ]
        ))
        let plan = OpenAICodexToolPartNormalizer().normalize(part(
            "update_plan",
            input: ["plan": .array([.object(["step": .string("Ship"), "status": .string("pending")])])]
        ))
        let fallback = OpenAICodexToolPartNormalizer().normalize(part("weird_tool", input: [:]))

        #expect(patch.count == 2)
        #expect(patch[0].kind == .edit)
        #expect(patch[1].kind == .write)
        #expect(plan.first?.kind == .todo)
        #expect(fallback.first?.kind == .other)
    }

    @Test func providerDispatchAndFallbackNormalize() {
        let claude = ToolActionNormalizer.normalize(
            toolPart: part("Bash", input: ["command": .string("pwd")]),
            providerId: .claudeCode
        )
        let codex = ToolActionNormalizer.normalize(
            toolPart: part("exec", input: ["type": .string("commandExecution"), "command": .string("pwd")]),
            providerId: .openaiCodex
        )
        let unknown = ToolActionNormalizer.normalize(
            toolPart: part("Bash", input: ["command": .string("pwd")]),
            providerId: .unknown("future-provider")
        )
        let missing = ToolActionNormalizer.normalize(
            toolPart: part("Bash", input: ["command": .string("pwd")]),
            providerId: nil
        )
        let unhydrated = ToolActionNormalizer.normalize(
            toolPart: part("exec", input: [
                "type": .string("commandExecution"),
                "command": .string("pwd")
            ]),
            providerId: .unknown("")
        )
        let unhydratedClaude = ToolActionNormalizer.normalize(
            toolPart: part("Bash", input: ["command": .string("pwd")]),
            providerId: .unknown("")
        )

        #expect(claude.first?.kind == .bash)
        #expect(codex.first?.kind == .bash)
        #expect(unknown.first?.kind == .other)
        #expect(missing.first?.kind == .other)
        #expect(unhydrated.first?.kind == .other)
        #expect(unhydratedClaude.first?.kind == .other)
    }

    private func part(
        _ toolName: String,
        input: [String: JSONValue] = [:],
        output: JSONValue? = nil
    ) -> NormalizableToolPart {
        NormalizableToolPart(
            toolName: toolName,
            input: .object(input),
            output: output
        )
    }
}
