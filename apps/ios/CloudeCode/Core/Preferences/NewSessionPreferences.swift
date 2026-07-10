import CoreAPI
import Foundation

/// Persists the user's last valid model and repository choices for new sessions.
final class NewSessionPreferences {
    struct LastSelectedModel: Codable, Equatable {
        let providerId: String
        let modelId: String
        let displayName: String
        let effortId: String?
        let effortDisplayName: String?
    }

    struct LastSelectedRepo: Codable, Equatable {
        let id: Int
        let fullName: String
        let defaultBranch: String
    }

    private let userDefaults: UserDefaults
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    // todo use appgroup user defaults from app component
    init(userDefaults: UserDefaults) {
        self.userDefaults = userDefaults
    }

    var lastSelectedModel: LastSelectedModel? {
        get {
            decode(LastSelectedModel.self, forKey: Constants.UserDefaults.lastSelectedNewSessionModel)
        }
        set {
            encode(newValue, forKey: Constants.UserDefaults.lastSelectedNewSessionModel)
        }
    }

    var lastSelectedRepo: LastSelectedRepo? {
        get {
            decode(LastSelectedRepo.self, forKey: Constants.UserDefaults.lastSelectedNewSessionRepo)
        }
        set {
            encode(newValue, forKey: Constants.UserDefaults.lastSelectedNewSessionRepo)
        }
    }

    func persistModel(
        provider: ProviderCatalogEntry,
        model: ProviderCatalogModel,
        effort: ProviderCatalogEffort?
    ) {
        lastSelectedModel = LastSelectedModel(
            providerId: provider.providerId.rawValue,
            modelId: model.id,
            displayName: model.displayName,
            effortId: effort?.id,
            effortDisplayName: effort?.displayName
        )
    }

    func persistRepo(_ repo: Repo) {
        lastSelectedRepo = LastSelectedRepo(
            id: repo.id,
            fullName: repo.fullName,
            defaultBranch: repo.defaultBranch
        )
    }

    private func decode<Value: Decodable>(_ type: Value.Type, forKey key: String) -> Value? {
        guard let data = userDefaults.data(forKey: key) else {
            return nil
        }
        return try? decoder.decode(type, from: data)
    }

    private func encode<Value: Encodable>(_ value: Value?, forKey key: String) {
        guard let value else {
            userDefaults.removeObject(forKey: key)
            return
        }
        guard let data = try? encoder.encode(value) else {
            return
        }
        userDefaults.set(data, forKey: key)
    }
}
