import API
import Domain
import Entities
import Testing
@testable import CloudeCode

@MainActor
extension AgentSessionTranscriptStateTests {
    @Test func cachedStreamingMessageRestoresAsSameTurnRow() async throws {
        let messageStore = SessionMessageStore()
        try await messageStore.replace(
            sessionId: "session-1",
            with: [userMessage(id: "user-1")]
        )
        messageStore.upsert(
            sessionId: "session-1",
            message: assistantMessage(id: "cached-partial", text: "Working"),
            isStreaming: true
        )
        let viewModel = makeViewModel(sessionMessageStore: messageStore)

        await viewModel.loadCachedMessages()

        let row = try #require(viewModel.transcriptRows.last)
        #expect(viewModel.transcriptRows.map(\.messageID) == ["user-1", "cached-partial"])
        #expect(row.id == "message:cached-partial")
        #expect(row.isStreaming)
    }

    @Test func liveStreamingUpdateUsesRestoredCanonicalRow() async throws {
        let messageStore = SessionMessageStore()
        try await messageStore.replace(
            sessionId: "session-1",
            with: [userMessage(id: "user-1")]
        )
        messageStore.upsert(
            sessionId: "session-1",
            message: assistantMessage(id: "assistant-1", text: "Working"),
            isStreaming: true
        )
        let viewModel = makeViewModel(sessionMessageStore: messageStore)
        await viewModel.loadCachedMessages()
        let restoredRowID = try #require(viewModel.transcriptRows.last).id

        viewModel.applyStreamingMessage(
            assistantMessage(id: "assistant-1", text: "Still working")
        )

        let row = try #require(viewModel.transcriptRows.last)
        #expect(row.id == restoredRowID)
        #expect(row.messageID == "assistant-1")
        #expect(row.isStreaming)
        #expect(viewModel.messagesByID["assistant-1"]?.text == "Still working")
    }

    @Test func completedServerMessageTakesRestoredStreamingRowID() async throws {
        let messageStore = SessionMessageStore()
        try await messageStore.replace(
            sessionId: "session-1",
            with: [userMessage(id: "user-1")]
        )
        messageStore.upsert(
            sessionId: "session-1",
            message: assistantMessage(id: "assistant-1", text: "Working"),
            isStreaming: true
        )
        let viewModel = makeViewModel(sessionMessageStore: messageStore)
        await viewModel.loadCachedMessages()
        let restoredRowID = try #require(viewModel.transcriptRows.last).id

        await viewModel.handle(.syncResponse(SessionSyncSnapshot(
            messages: [
                userMessage(id: "user-1"),
                assistantMessage(id: "assistant-1", text: "Done")
            ],
            pendingChunks: [],
            pendingMessageMetadata: nil,
            activeTurnUserMessageId: nil
        )))

        let row = try #require(viewModel.transcriptRows.last)
        let cachedMessageIDs = try await messageStore.messages(sessionId: "session-1").map(\.id)
        #expect(row.id == restoredRowID)
        #expect(row.messageID == "assistant-1")
        #expect(!row.isStreaming)
        #expect(viewModel.streamingTranscriptRowID == nil)
        #expect(cachedMessageIDs == ["user-1", "assistant-1"])
    }

    @Test func serverSnapshotWithoutActiveTurnInvalidatesCachedStreamingRow() async throws {
        let messageStore = SessionMessageStore()
        try await messageStore.replace(
            sessionId: "session-1",
            with: [userMessage(id: "user-1")]
        )
        messageStore.upsert(
            sessionId: "session-1",
            message: assistantMessage(id: "cached-partial", text: "Working"),
            isStreaming: true
        )
        let viewModel = makeViewModel(sessionMessageStore: messageStore)
        await viewModel.loadCachedMessages()

        await viewModel.handle(.syncResponse(SessionSyncSnapshot(
            messages: [userMessage(id: "user-1")],
            pendingChunks: [],
            pendingMessageMetadata: nil,
            activeTurnUserMessageId: nil
        )))

        let cachedMessageIDs = try await messageStore.messages(sessionId: "session-1").map(\.id)
        #expect(viewModel.transcriptRows.map(\.messageID) == ["user-1"])
        #expect(viewModel.messagesByID["cached-partial"] == nil)
        #expect(viewModel.streamingTranscriptRowID == nil)
        #expect(cachedMessageIDs == ["user-1"])
    }
}
