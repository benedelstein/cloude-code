# iOS Message Cache

## Context

Message loading takes a long time. If a DO has to spin up, it could take a few seconds.
We want loading to feel instant - so caching is necessary

## Architecture

The app uses a shared caching architecture using SwiftData. All cached entities become SwiftData types,
and a generic `EntityStore` is created to map from swiftdata to usable app models.
EntityStore expects that the app models are reference types, which allows us to easily update the cached data in place.

However, because message display within `AgentSessionViewModel` is based on `SessionMessage` structs, the app should not pass message reference types through the transcript UI. We only need a wrapper type inside the cache layer because `EntityStore` requires an `EntityModel`.

### Wire Message Metadata

Keep `WireUIMessage.metadata` generated as `JSONValue?` for now and add typed
Swift accessors for the known timestamp fields the cache depends on.

Persisted server messages must include `metadata.createdAt` as an ISO timestamp.
iOS parses this once at the cache boundary and stores it as a SwiftData `Date`
column for sorting and future date predicates.

The accessor path looks like:

```swift
extension Domain.SessionMessage {
    var createdAtMetadata: String? {
        metadata?["createdAt"]?.stringValue
    }

    var startedAtMetadata: Double? {
        metadata?["startedAt"]?.numberValue
    }

    var endedAtMetadata: Double? {
        metadata?["endedAt"]?.numberValue
    }
}
```

This is safer than changing `metadata: z.unknown()` to a typed object in the
first cache implementation. `metadata` is intentionally open-ended because
provider/runtime metadata can carry arbitrary JSON. The current Swift codegen
maps `z.unknown()` to `JSONValue`, which preserves all metadata losslessly.

If we later want `message.metadata?.createdAt` as a generated typed property,
then codegen needs to support object schemas with both known properties and
additional properties:

```ts
export type WireUIMessageMetadata = {
  createdAt?: string;
  startedAt?: number;
  endedAt?: number;
  [key: string]: JSONPayload | undefined;
};
```

```swift
public struct WireUIMessageMetadata: Codable, Equatable, Sendable {
    public var createdAt: String?
    public var startedAt: Double?
    public var endedAt: Double?
    public var additionalProperties: [String: JSONValue]
}
```

The generated `init(from:)` must decode known keys into typed properties and
preserve every unknown key in `additionalProperties`. The generated `encode(to:)`
must write both known properties and all additional properties back out. Without
that, the typed metadata change is not worth it.

### Cache Types

Caching has 3 layers:

1. A SwiftData `Entity` (`PersistentModel`)
2. An app model, `EntityModel`
3. A sendable mapping type that can map from entity to app model (needed because swiftdata types are not thread-safe)

`SessionMessageEntity  <->  SessionMessageData  <->  SessionMessageWrapper`

Create a wrapper class around the `SessionMessage` struct that conforms to `EntityModel`

```swift
/// Wrapper such that we carry through the session id to the cache?
public struct SessionMessageData: Sendable, Codable, Identifiable {
    // Required by EntityStore identity, derived from the message payload.
    public var id: String { message.id }
    public let sessionId: String
    // Cache/query field mirrored from SessionMessageEntity.createdAt. This is
    // parsed once from message.metadata.createdAt at the cache boundary, or
    // set to a local fallback for provisional optimistic messages.
    public let createdAt: Date
    public let message: Domain.SessionMessage
}
```

```swift
/// Wrapper for storing session messages in cache 
// We're really just interested in the `SessionMessage`
@MainActor
class SessionMessageWrapper: EntityModel {
    typealias Snapshot = SessionMessageData
    typealias EntityType = SessionMessageEntity

    public let id: String 
    public private(set) var message: Domain.SessionMessage
    public private(set) var sessionId: String
    public private(set) var createdAt: Date
    
    public var role: Domain.SessionMessage.Role {
        message.role
    }

    public init(_ snapshot: SessionMessageData) {
        self.id = snapshot.id
        self.message = snapshot.message
        self.sessionId = snapshot.sessionId
        self.createdAt = snapshot.createdAt
    }

    func update(from snapshot: Snapshot) {
        self.message = snapshot.message
        self.sessionId = snapshot.sessionId
        self.createdAt = snapshot.createdAt
    }

    var snapshot: SessionMessageData {
        SessionMessageData(
            id: id,
            sessionId: sessionId,
            message: message,
            createdAt: createdAt
        )
    }
}

@Model
class SessionMessageEntity: Entity {
    typealias Snapshot = SessionMessageData

    @Attribute(.unique) public private(set) var id: String
    var role: String
    var sessionId: String
    var createdAt: Date
    // Store the Codable domain message directly. Query fields stay first-class
    // columns so reads do not have to decode every message just to sort/filter.
    var message: Domain.SessionMessage

    init(_ snapshot: SessionMessageData) {
        id = snapshot.id
        role = snapshot.message.role.rawValue
        sessionId = snapshot.sessionId
        createdAt = snapshot.createdAt
        message = snapshot.message
    }

    func update(_ snapshot: SessionMessageData) {
        role = snapshot.message.role.rawValue
        sessionId = snapshot.sessionId
        createdAt = snapshot.createdAt
        message = snapshot.message
    }

    var snapshot: SessionMessageData {
        SessionMessageData(
            id: id,
            sessionId: sessionId,
            message: message,
            createdAt: createdAt
        )
    }

    static func singleItemPredicate(_ id: String) -> Predicate<SessionMessageEntity> {
        #Predicate { $0.id == id }
    }

    static func multiItemPredicate(_ ids: Set<String>) -> Predicate<SessionMessageEntity> {
        #Predicate { ids.contains($0.id) }
    }
}
```

### Store Shape

The main way we will use the store is to get messages for a given session id, sorted by date.

Do not subclass EntityStore as-is; it is final in EntityStore.swift (line 30). Use composition:

```swift
@MainActor
@Observable
public final class SessionMessageStore {
    typealias Model = SessionMessageWrapper
    // crud for messages by id. 
    private let entityStore: EntityStore<Model>

    public private(set) var loadedSessionIDs: Set<String> = []
    // Ordered secondary index. The full objects live in entityStore.objectMap.
    @ObservationIgnored private var messageIDsBySessionID: [String: [String]] = [:]

    public subscript(messageID: String) -> SessionMessage? {
        entityStore[messageID]?.message
    }

    /// Returns cached messages for a session, preferring the in-memory session index.
    public func messages(sessionId: String) async throws -> [SessionMessage] {
        if let models = modelsFromMemory(sessionId: sessionId) {
            return models.map(\.message)
        }

        let models = try await entityStore.getFromDisk(
            predicate: #Predicate<SessionMessageEntity> {
                $0.sessionId == sessionId
            },
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )

        index(models, for: sessionId)
        loadedSessionIDs.insert(sessionId)

        return models.map(\.message)
    }

    /// Replaces the cached contents for one session with a canonical server snapshot.
    func replace(sessionId: String, with messages: [SessionMessage])
    func upsert(sessionId: String, message: SessionMessage)
    func deleteSessionMessages(sessionId: String)
    func delete(ids: Set<String>)

    private func modelsFromMemory(sessionId: String) -> [SessionMessageWrapper]? {
        guard loadedSessionIDs.contains(sessionId),
              let ids = messageIDsBySessionID[sessionId] else {
            return nil
        }

        return ids.compactMap { entityStore[$0] }
    }

    private func index(_ models: [SessionMessageWrapper], for sessionId: String) {
        messageIDsBySessionID[sessionId] = models
            .filter { $0.sessionId == sessionId }
            .sorted { $0.createdAt < $1.createdAt }
            .map(\.id)
    }
}
```

### Loading Logic

1. When a session is bound (`AgentSessionViewModel.bind()`), load the messages from the cache.
2. Simultaneously start the websocket connection
3. When the `sync.response` event is received, replace the messages in state and overwrite the cache.
4. When a new message is finalized `agent.finish`, upsert the message into the cache.
5. When `chat.accepted` arrives, use the existing optimistic message: replace the client-generated id with the server message id, remove the optimistic marker, update visible state, and upsert that accepted user message into the cache with a local `createdAt` fallback. A later `sync.response` will replace it with the canonical server message and server `metadata.createdAt`.
6. When a new user message is received (`user.message`), upsert the message into the cache.
7. `replace(sessionId:with:)` should prune stale rows and upsert fresh rows in one awaited SwiftData operation, not as separate fire-and-forget delete and put tasks.

### Decode Compatibility

The cache stores `Domain.SessionMessage`, not raw wire JSON. Today, unknown wire message parts are handled before caching: `WireUIMessagePart` is an open union and the API mapping converts unrecognized parts into `SessionMessage.Part.unknown` with the raw JSON payload. That means an old app can cache newly-added server part types as `unknown` and decode them again later.

The remaining risk is app downgrade or a future incompatible change to the `Domain.SessionMessage` Codable shape. Cache reads should treat decode failure as a recoverable cache miss: delete the unreadable row or session cache and let the websocket/API sync repopulate it. Do not let one bad cached message break session loading.

## Future  Optimizations

- Keep a warm cache of `AgentSessionViewModel` instances for recently-used sessions. 
This could cache not only messages, but also display data and websocket state.

