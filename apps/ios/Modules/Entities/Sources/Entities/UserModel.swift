import Domain
import Observation

@MainActor
@Observable
public final class UserModel: EntityModel {
    public typealias EntityType = UserEntity

    public let id: String
    public var login: String
    public var name: String?
    public var avatarUrl: String?

    public init(_ snapshot: Domain.User) {
        id = snapshot.id
        login = snapshot.login
        name = snapshot.name
        avatarUrl = snapshot.avatarUrl
    }

    public func update(from snapshot: Domain.User) {
        updateIfChanged(\.login, to: snapshot.login)
        updateIfChanged(\.name, to: snapshot.name)
        updateIfChanged(\.avatarUrl, to: snapshot.avatarUrl)
    }

    public var snapshot: Domain.User {
        Domain.User(id: id, login: login, name: name, avatarUrl: avatarUrl)
    }
}

public typealias UserStore = EntityStore<UserModel>
