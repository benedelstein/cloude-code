import CoreAPI
import SwiftUI

extension AgentSessionView {
    enum Destination: Identifiable, Equatable {
        case image(SessionImageInfo)
        case renderItem(AgentSessionRenderItem)
        case providerConnection(ProviderConnectionContext)

        var id: String {
            switch self {
            case .image(let image):
                "image_\(image.id)"
            case .renderItem(let item):
                item.key
            case .providerConnection(let context):
                "provider_connection_\(context.providerId.rawValue)"
            }
        }
    }

    struct Destinations: ViewModifier {
        @Environment(\.providerConnectionBuilder) private var providerConnectionBuilder
        @Binding var destination: Modal<Destination>?

        func body(content: Content) -> some View {
            content
                .withModal($destination) { destination in
                    switch destination {
                    case .image(let image):
                        FullscreenImageView(image: image)
                    case .renderItem(let item):
                        AgentSessionToolDetailSheet(item: item)
                            .presentationDetents([PresentationDetent.medium, PresentationDetent.large])
                            .presentationBackground(.clear)
                    case .providerConnection(let context):
                        if let providerConnectionBuilder {
                            providerConnectionBuilder.build(context: context) {
                                self.destination = nil
                            }
                        } else {
                            ContentUnavailableView(
                                "Provider connection unavailable",
                                systemImage: "exclamationmark.triangle"
                            )
                        }
                    }
                }
        }
    }
}
