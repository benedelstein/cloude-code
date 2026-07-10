import API
import CoreAPI
import Domain
import Entities
import Foundation
import Testing
@testable import CloudeCode

/// Covers the transcript row/content state machine: stable row identity across
/// message id changes (streaming -> final, optimistic -> accepted) and the
/// row/`messagesByID` consistency invariants.
@MainActor
struct AgentSessionTranscriptStateTests {
    @Test func streamingRowBecomesFinalRowInPlace() throws {
        let viewModel = makeViewModel()
        viewModel.applyStreamingMessage(assistantMessage(id: "partial-1", text: "he"))

        let rowID = try #require(viewModel.transcriptRows.last).id
        viewModel.applyAgentFinish(assistantMessage(id: "server-1", text: "hello"))

        let row = try #require(viewModel.transcriptRows.first)
        #expect(viewModel.transcriptRows.count == 1)
        #expect(row.id == rowID)
        #expect(row.messageID == "server-1")
        #expect(!row.isStreaming)
        #expect(viewModel.messagesByID["partial-1"] == nil)
        #expect(viewModel.messagesByID["server-1"]?.text == "hello")
    }

    @Test func acceptOptimisticUserMessageKeepsRowID() throws {
        let viewModel = makeViewModel()
        viewModel.upsert(optimisticUserMessage(id: "client-1"))

        let rowID = try #require(viewModel.transcriptRows.first).id
        viewModel.acceptOptimisticUserMessage(clientMessageId: "client-1", messageId: "server-9")

        let row = try #require(viewModel.transcriptRows.first)
        #expect(viewModel.transcriptRows.count == 1)
        #expect(row.id == rowID)
        #expect(row.messageID == "server-9")
        #expect(viewModel.messagesByID["client-1"] == nil)
        #expect(viewModel.messagesByID["server-9"]?.isOptimisticUserMessage == false)
    }

    @Test func snapshotRebuildMidStreamDoesNotDuplicateFinishedMessage() {
        let viewModel = makeViewModel()
        viewModel.applyStreamingMessage(assistantMessage(id: "server-2", text: "partial"))

        // A full snapshot lands mid-stream and already contains the message.
        viewModel.rebuildTranscript(from: [
            userMessage(id: "u1"),
            assistantMessage(id: "server-2", text: "partial")
        ])
        viewModel.applyAgentFinish(assistantMessage(id: "server-2", text: "final"))

        #expect(viewModel.transcriptRows.count == 2)
        #expect(viewModel.transcriptRows.filter { $0.messageID == "server-2" }.count == 1)
        #expect(viewModel.messagesByID["server-2"]?.text == "final")
    }

    @Test func rebuildPreservesExistingRowIDs() throws {
        let viewModel = makeViewModel()
        viewModel.upsert(userMessage(id: "u1"))
        let rowID = try #require(viewModel.transcriptRows.first).id

        viewModel.rebuildTranscript(from: [userMessage(id: "u1"), assistantMessage(id: "a1")])

        #expect(viewModel.transcriptRows.first?.id == rowID)
        #expect(viewModel.transcriptRows.count == 2)
        #expect(viewModel.messagesByID.count == 2)
    }

    @Test func clearStreamingStateRemovesPartialRowAndContent() {
        let viewModel = makeViewModel()
        viewModel.applyStreamingMessage(assistantMessage(id: "partial-1", text: "he"))

        viewModel.clearStreamingState(removeActiveTranscript: true)

        #expect(viewModel.transcriptRows.isEmpty)
        #expect(viewModel.messagesByID["partial-1"] == nil)
        #expect(viewModel.assistantDisplayDataByRowID.isEmpty)
    }
}

private extension AgentSessionTranscriptStateTests {
    struct StubTranscriptBuilder: AgentSessionTranscriptBuilding {
        func build(
            message: SessionMessage,
            providerId: AgentProviderID?
        ) -> [AgentSessionRenderItem] {
            []
        }

        func finalResponseStartIndex(renderItems: [AgentSessionRenderItem]) -> Int? {
            nil
        }
    }

    struct StubAttachmentsAPI: AttachmentsAPIProviding {
        func uploadImages(
            _ files: [AttachmentUploadFile],
            sessionId: String?
        ) async throws -> [UploadedAttachment] {
            []
        }

        func deleteAttachment(id attachmentId: String) async throws {}
    }

    struct StubModelsAPI: ModelsAPIProviding {
        func models() async throws -> ModelsResponse {
            throw URLError(.badServerResponse)
        }
    }

    func makeViewModel() -> AgentSessionViewModel {
        AgentSessionViewModel(
            context: .session(SessionSummaryModel(SessionSummary(
                id: "session-1",
                repoId: 1,
                repoFullName: "octo/repo",
                archived: false,
                workingState: "idle",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
                hasUnread: false
            ))),
            modelPicker: ModelPickerState(modelsAPI: StubModelsAPI()),
            makeSocket: { sessionId in
                // Never dialed: these tests exercise state transitions without connecting.
                SessionSocket(
                    baseURL: URL(fileURLWithPath: "/dev/null"),
                    sessionId: sessionId,
                    tokenCache: WebSocketTokenCache { throw URLError(.userAuthenticationRequired) }
                )
            },
            sessionMessageStore: SessionMessageStore(),
            sessionSummaryStore: SessionSummaryStore(),
            transcriptBuilder: StubTranscriptBuilder(),
            attachmentsAPI: StubAttachmentsAPI()
        )
    }

    func userMessage(id: String, text: String = "hello") -> SessionMessage {
        SessionMessage(id: id, role: .user, text: text)
    }

    func optimisticUserMessage(id: String, text: String = "hello") -> SessionMessage {
        SessionMessage(
            id: id,
            role: .user,
            text: text,
            metadata: .object(["optimistic": .bool(true)])
        )
    }

    func assistantMessage(id: String, text: String = "hi") -> SessionMessage {
        SessionMessage(id: id, role: .assistant, text: text)
    }
}
