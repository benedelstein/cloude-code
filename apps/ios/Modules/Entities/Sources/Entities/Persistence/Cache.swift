import Foundation
import SwiftData

/// SwiftData persistence runner, ported from Gallery.
///
/// Work runs on a `DataHandler` model actor created on a background queue —
/// a `@ModelActor`'s executor is bound to where it was created, so creating
/// one on the main thread would run "background" work on main.
public final class Cache: Sendable {
    /// Increment this version to reset the whole cache.
    public static let version: Int = 1

    private let container: ModelContainer
    private let backgroundQueue = DispatchQueue(label: "llc.bze.CloudeCode.cache")

    public init(container: ModelContainer) {
        self.container = container
    }

    public func reset() async throws {
        for model in CurrentSchema.models {
            try await runBackgroundTask { context in
                try context.delete(model: model)
            }
        }
    }

    func runBackgroundTask<T: Sendable>(
        block: @Sendable @escaping (ModelContext) throws -> T
    ) async throws -> T {
        let handler = backgroundQueue.sync {
            DataHandler(modelContainer: container)
        }
        return try await handler.execute(block: block)
    }
}

/*
 This must be initialized on a background queue to work correctly.

 "another important principle is to avoid passing NSManagedObject instances between contexts.
 This rule also applies to SwiftData.
 If you want to operate on the storage data corresponding to a PersistentModel in another
 ModelContext, you can solve it by passing the PersistentIdentifier of the object.
 PersistentIdentifier can be seen as the SwiftData implementation of NSManagedObjectId."
 */
@ModelActor
private actor DataHandler {
    func execute<T: Sendable>(
        block: @Sendable @escaping (ModelContext) throws -> T
    ) throws -> T {
        assert(!Thread.isMainThread)
        let result = try block(modelContext)

        if modelContext.hasChanges {
            try modelContext.save()
        }
        return result
    }
}
