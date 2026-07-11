import Foundation

extension UserDefaults {
    /// Decodes a JSON-encoded value stored under `key`, returning `nil` when the entry is missing or fails to decode.
    func codableValue<Value: Decodable>(_ type: Value.Type, forKey key: String) -> Value? {
        guard let data = data(forKey: key) else {
            return nil
        }
        return try? JSONDecoder().decode(type, from: data)
    }

    /// JSON-encodes `value` and stores it under `key`. Passing `nil` removes the entry.
    func setCodableValue<Value: Encodable>(_ value: Value?, forKey key: String) {
        guard let value else {
            removeObject(forKey: key)
            return
        }
        guard let data = try? JSONEncoder().encode(value) else {
            return
        }
        set(data, forKey: key)
    }
}
