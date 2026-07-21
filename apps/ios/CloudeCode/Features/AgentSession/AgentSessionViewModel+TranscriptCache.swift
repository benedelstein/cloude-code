import Domain
import Entities

private struct TranscriptMessageSource {
    let message: SessionMessage
    let streamingTurnUserMessageID: String?
    let rowIDOverride: String?

    init(
        message: SessionMessage,
        streamingTurnUserMessageID: String? = nil,
        rowIDOverride: String? = nil
    ) {
        self.message = message
        self.streamingTurnUserMessageID = streamingTurnUserMessageID
        self.rowIDOverride = rowIDOverride
    }
}

extension AgentSessionViewModel {
    /// Rebuilds rows and content from an ordered canonical message list
    /// (server snapshot or disk cache).
    func rebuildTranscript(from messages: [SessionMessage]) {
        replaceTranscript(with: messages.map { TranscriptMessageSource(message: $0) })
    }

    func rebuildTranscript(from records: [SessionMessageData]) {
        replaceTranscript(with: records.map { record in
            TranscriptMessageSource(
                message: record.message,
                streamingTurnUserMessageID: record.streamingTurnUserMessageId
            )
        })
    }

    func rebuildTranscriptForSync(
        from messages: [SessionMessage],
        activeTurnUserMessageID: String?,
        hasPendingChunks: Bool
    ) {
        let preservedStreaming = preservedStreamingSource()
        var sources = messages.map { TranscriptMessageSource(message: $0) }

        if let preservedStreaming {
            if hasPendingChunks,
               activeTurnUserMessageID == preservedStreaming.streamingTurnUserMessageID {
                insertStreamingSource(preservedStreaming, into: &sources)
            } else if let userMessageID = preservedStreaming.streamingTurnUserMessageID,
                      let finalMessageID = assistantResponseMessageID(
                to: userMessageID,
                in: messages
            ), let index = sources.firstIndex(where: { $0.message.id == finalMessageID }) {
                sources[index] = TranscriptMessageSource(
                    message: sources[index].message,
                    rowIDOverride: preservedStreaming.rowIDOverride
                )
            }
        }

        replaceTranscript(with: sources)
    }

    func activeStreamingTranscriptRowID() -> String {
        if let streamingTranscriptRowID {
            return streamingTranscriptRowID
        }

        let rowID = streamingTurnUserMessageID.map { streamingTranscriptRowID(for: $0) }
            ?? "streaming-turn:\(streamGeneration)"
        streamingTranscriptRowID = rowID
        return rowID
    }

    private func replaceTranscript(with sources: [TranscriptMessageSource]) {
        let outgoingRows = transcriptRows
        var nextStreamingRowID: String?
        var nextStreamingTurnUserMessageID: String?
        let nextRows = sources.map { source in
            let isStreaming = source.streamingTurnUserMessageID != nil
            let rowID = rowID(for: source, preserving: outgoingRows)

            if let turnUserMessageID = source.streamingTurnUserMessageID {
                nextStreamingRowID = rowID
                nextStreamingTurnUserMessageID = turnUserMessageID
            }
            return TranscriptRow(
                id: rowID,
                messageID: source.message.id,
                isStreaming: isStreaming
            )
        }
        let nextMessagesByID = Dictionary(
            sources.map { ($0.message.id, $0.message) }
        ) { _, latest in latest }

        transcriptRows = nextRows
        messagesByID = nextMessagesByID
        streamingTranscriptRowID = nextStreamingRowID
        streamingTurnUserMessageID = nextStreamingTurnUserMessageID
        rebuildTranscriptDisplayData()
        assertTranscriptStateConsistency()
    }

    private func rowID(
        for source: TranscriptMessageSource,
        preserving outgoingRows: [TranscriptRow]
    ) -> String {
        if let rowIDOverride = source.rowIDOverride {
            return rowIDOverride
        }
        if let turnUserMessageID = source.streamingTurnUserMessageID {
            return streamingTranscriptRowID(for: turnUserMessageID)
        }
        if let existingRow = outgoingRows.last(where: {
            !$0.isStreaming && $0.messageID == source.message.id
        }) {
            return existingRow.id
        }
        return SessionTranscriptItem.messageItemID(for: source.message.id)
    }

    private func streamingTranscriptRowID(for userMessageID: String) -> String {
        "streaming-turn:\(userMessageID)"
    }

    private func preservedStreamingSource() -> TranscriptMessageSource? {
        guard let streamingTranscriptRowID,
              let streamingTurnUserMessageID,
              let row = transcriptRows.last(where: {
                  $0.id == streamingTranscriptRowID && $0.isStreaming
              }),
              let message = messagesByID[row.messageID] else {
            return nil
        }
        return TranscriptMessageSource(
            message: message,
            streamingTurnUserMessageID: streamingTurnUserMessageID,
            rowIDOverride: row.id
        )
    }

    private func insertStreamingSource(
        _ source: TranscriptMessageSource,
        into sources: inout [TranscriptMessageSource]
    ) {
        guard let userMessageID = source.streamingTurnUserMessageID else {
            return
        }
        guard let userIndex = sources.lastIndex(where: {
            $0.message.id == userMessageID
        }) else {
            sources.append(source)
            return
        }
        sources.insert(source, at: userIndex + 1)
    }

    private func assistantResponseMessageID(
        to userMessageID: String,
        in messages: [SessionMessage]
    ) -> String? {
        guard let userIndex = messages.lastIndex(where: { $0.id == userMessageID }) else {
            return nil
        }
        for message in messages.dropFirst(userIndex + 1) {
            if message.role == .user {
                return nil
            }
            if message.role == .assistant {
                return message.id
            }
        }
        return nil
    }
}
