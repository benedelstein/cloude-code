import Domain
import Foundation
import Valet

/// App-group Valet so widgets/extensions can share the session later. The
/// group ID is per-environment, injected via Config/*.xcconfig → Info.plist
/// (`APP_GROUP_IDENTIFIER`), same flow as `API_BASE_URL`.
struct KeychainSessionPersistence: SessionPersisting {
    private let valet: Valet

    /// - Parameter appGroup: full app group ID, e.g. `group.llc.bze.CloudeCode`.
    init(appGroup: String) {
        let group = appGroup.hasPrefix("group.")
            ? String(appGroup.dropFirst("group.".count))
            : appGroup
        guard let identifier = SharedGroupIdentifier(groupPrefix: "group", nonEmptyGroup: group) else {
            preconditionFailure("invalid app group identifier: \(appGroup)")
        }
        valet = Valet.sharedGroupValet(with: identifier, accessibility: .afterFirstUnlock)
    }

    private static let key = "auth.session"

    func load() throws -> Session? {
        guard let data = try? valet.object(forKey: Self.key) else { return nil }
        return try JSONDecoder().decode(Session.self, from: data)
    }

    func save(_ session: Session) throws {
        try valet.setObject(JSONEncoder().encode(session), forKey: Self.key)
    }

    func clear() throws {
        try valet.removeObject(forKey: Self.key)
    }
}
