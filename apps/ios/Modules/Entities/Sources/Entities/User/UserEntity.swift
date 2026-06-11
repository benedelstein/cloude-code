import Domain
import Foundation
import SwiftData

/// SwiftData persistence row for `Domain.User`. Only `Cache` should touch
/// entity instances — everything else speaks `Domain.User`.
@Model
public final class UserEntity: Entity {
    @Attribute(.unique) public private(set) var id: String
    var login: String
    var name: String?
    var avatarUrl: String?

    public init(_ snapshot: Domain.User) {
        id = snapshot.id
        login = snapshot.login
        name = snapshot.name
        avatarUrl = snapshot.avatarUrl
    }

    public func update(_ snapshot: Domain.User) {
        login = snapshot.login
        name = snapshot.name
        avatarUrl = snapshot.avatarUrl
    }

    public var snapshot: Domain.User {
        Domain.User(id: id, login: login, name: name, avatarUrl: avatarUrl)
    }

    public static func singleItemPredicate(_ id: String) -> Predicate<UserEntity> {
        #Predicate { $0.id == id }
    }

    public static func multiItemPredicate(_ ids: Set<String>) -> Predicate<UserEntity> {
        #Predicate { ids.contains($0.id) }
    }
}
