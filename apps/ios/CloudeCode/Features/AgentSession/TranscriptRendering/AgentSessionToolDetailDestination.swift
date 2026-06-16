enum AgentSessionToolDetailDestination: Identifiable, Equatable {
    case renderItem(AgentSessionRenderItem)

    var id: String {
        switch self {
        case .renderItem(let item):
            item.key
        }
    }
}
