# Caching

The iOS app caches small server/domain records with SwiftData through the
`Modules/Entities` package.

## Model

Cached data has three representations:

- `Domain` struct: `Sendable`, value-typed snapshot used across API, disk, sockets,
  and actor boundaries.
- SwiftData `@Model`: persistent row type under `Modules/Entities/.../Persistence`.
  It conforms to `Entity` and maps to/from the domain snapshot.
- `EntityModel`: `@MainActor`, `@Observable`, reference-identity view model.
  Views use these classes, not SwiftData rows.

The boundary is:

```text
SwiftData Entity <-> Domain Snapshot <-> EntityModel
```

SwiftData model instances never leave `Cache`'s background model actor. Main-actor
models never cross actor boundaries as data. `EntityStore<Model>` is the merge point.

## Runtime Flow

`ApplicationComponent` creates one shared `Cache` from `ModelContainerFactory`.
Stores are then shared dependencies, for example `UserStore` and
`SessionSummaryStore`.

`EntityStore` fetches in this order:

1. Memory: return canonical `EntityModel` instances already in `objectMap`.
2. Disk: fetch domain snapshots from `Cache`, then merge into `objectMap`.
3. Network: optional `getAPI`, then `putDisk(_:)` to merge memory and persist.

Writes use the same identity rules:

- `putMemory(_:)` updates existing model instances in place or creates them.
- `putDisk(_:)` writes snapshots to SwiftData in a background task, then updates memory.
- `save(_:)` persists current model state by converting models back to snapshots.
- `delete(_:)` removes ids from memory and disk.

## Adding a Cached Type

1. Add a `Sendable`, `Identifiable<String>` domain struct in `Modules/Domain`.
2. Add a SwiftData `@Model` row in `Modules/Entities/.../Persistence` that conforms
   to `Entity`.
3. Implement `init(_ snapshot:)`, `update(_:)`, `snapshot`,
   `singleItemPredicate(_:)`, and `multiItemPredicate(_:)` on the row type.
4. Add an `@MainActor @Observable` model class that conforms to `EntityModel`.
   Use `updateIfChanged` in `update(from:)` to avoid needless invalidations.
5. Add a store typealias, e.g. `public typealias ThingStore = EntityStore<ThingModel>`.
6. Register the SwiftData row in `SchemaV1.models` or a new schema version in
   `ModelContainerFactory`.
7. Wire the store through Needle in `ApplicationComponent`, passing a `getAPI` closure
   only if the store should fetch missing ids from the network.

Current examples: `UserEntity`/`UserModel` and
`SessionSummaryEntity`/`SessionSummaryModel`.

## Schema Changes

For additive changes that SwiftData can migrate automatically:

1. Add the field to the domain snapshot, entity row, and model class.
2. Update `init`, `update`, and `snapshot` mappings in both row and model.
3. Add focused cache tests for read, upsert, delete, and any new query behavior.

For breaking or non-lightweight changes:

1. Create a new `VersionedSchema` in `ModelContainerFactory`.
2. Point `CurrentSchema` at the new schema.
3. Add the needed `MigrationStage`.
4. Keep old schema model definitions available for the migration.
5. Test migration with a persisted container, not only the in-memory test cache.

Increment `Cache.version` only when intentionally resetting the whole cache.

## Rules

- Use `EntityStore` for cached domain records. Do not add parallel ad hoc caches for
  the same data.
- Keep SwiftData rows private to persistence behavior. UI and feature code should
  use `EntityModel` instances or domain structs.
- Keep network mapping in `Modules/API`; `Entities` depends only on `Domain`.
- Do not store large blobs such as images or videos in SwiftData. Use files and store
  paths or ids if needed.
- Use Keychain for secrets and session tokens. Use `UserDefaults` only for simple,
  non-secret preferences.
