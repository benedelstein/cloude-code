public actor MemoryCache<Key: Hashable & Sendable, Value: Sendable> {
    private var storage: [Key: Value] = [:]

    public init() {}

    public func value(forKey key: Key) -> Value? {
        storage[key]
    }

    public func store(_ value: Value, forKey key: Key) {
        storage[key] = value
    }

    public func removeValue(forKey key: Key) {
        storage.removeValue(forKey: key)
    }

    public func removeAll() {
        storage.removeAll()
    }
}
