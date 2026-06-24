import SwiftData

public enum SchemaV1: VersionedSchema {
    public static let versionIdentifier = Schema.Version(1, 0, 0)

    public static var models: [any PersistentModel.Type] {
        [UserEntity.self, SessionSummaryEntity.self]
    }

    public static var entities: [any Entity.Type] {
        [UserEntity.self, SessionSummaryEntity.self]
    }
}

public enum SchemaV2: VersionedSchema {
    public static let versionIdentifier = Schema.Version(1, 1, 0)

    public static var models: [any PersistentModel.Type] {
        [UserEntity.self, SessionSummaryEntity.self, SessionMessageEntity.self]
    }
}

public typealias CurrentSchema = SchemaV2

public enum MigrationPlan: SchemaMigrationPlan {
    public static var schemas: [any VersionedSchema.Type] {
        [SchemaV1.self, SchemaV2.self]
    }

    // Add a MigrationStage per schema bump (e.g. .lightweight(fromVersion:toVersion:)).
    public static var stages: [MigrationStage] {
        [.lightweight(fromVersion: SchemaV1.self, toVersion: SchemaV2.self)]
    }
}

public struct ModelContainerFactory: Sendable {
    public init() {}

    public func make(inMemory: Bool = false) throws -> ModelContainer {
        let schema = Schema(versionedSchema: CurrentSchema.self)
        let configuration = ModelConfiguration(
            "CloudeCode",
            schema: schema,
            isStoredInMemoryOnly: inMemory,
            allowsSave: true,
            // Cache lives in the app sandbox. An app group container is only
            // needed if extensions/widgets ever read this store — switch to
            // .identifier(appGroup) then.
            groupContainer: .none,
            cloudKitDatabase: .none
        )

        return try ModelContainer(
            for: schema,
            migrationPlan: MigrationPlan.self,
            configurations: [configuration]
        )
    }
}
