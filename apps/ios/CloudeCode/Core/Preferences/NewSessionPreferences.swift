import CoreAPI
import Foundation

/// Persists the user's last valid model and repository choices for new sessions.
final class NewSessionPreferences {
    // These snapshot types are deliberately separate from the API/domain models:
    // they define a stable on-disk schema so changes to the API models can't
    // silently invalidate stored preferences, and they only persist the fields
    // needed to restore a selection.
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

    // todo use appgroup user defaults from app component
    init(userDefaults: UserDefaults) {
        self.userDefaults = userDefaults
    }

    var lastSelectedModel: LastSelectedModel? {
        get {
            userDefaults.codableValue(
                LastSelectedModel.self,
                forKey: Constants.UserDefaults.lastSelectedNewSessionModel
            )
        }
        set {
            userDefaults.setCodableValue(newValue, forKey: Constants.UserDefaults.lastSelectedNewSessionModel)
        }
    }

    var lastSelectedRepo: LastSelectedRepo? {
        get {
            userDefaults.codableValue(LastSelectedRepo.self, forKey: Constants.UserDefaults.lastSelectedNewSessionRepo)
        }
        set {
            userDefaults.setCodableValue(newValue, forKey: Constants.UserDefaults.lastSelectedNewSessionRepo)
        }
    }

    func persistRepo(_ repo: Repo) {
        lastSelectedRepo = LastSelectedRepo(
            id: repo.id,
            fullName: repo.fullName,
            defaultBranch: repo.defaultBranch
        )
    }
}
