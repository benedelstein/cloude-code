import SwiftUI

extension AgentSessionView {
    enum Destination: Identifiable, Equatable {
        case image(SessionImageInfo)
        case renderItem(AgentSessionRenderItem)

        var id: String {
            switch self {
            case .image(let image):
                "image_\(image.id)"
            case .renderItem(let item):
                item.key
            }
        }
    }

    struct Destinations: ViewModifier {
        @Binding var destination: Modal<Destination>?

        func body(content: Content) -> some View {
            content
                .withModal($destination) { destination in
                    switch destination {
                    case .image(let image):
                        AgentSessionFullscreenImageView(image: image)
                    case .renderItem(let item):
                        AgentSessionToolDetailSheet(item: item)
                            .presentationDetents([PresentationDetent.medium, PresentationDetent.large])
                            .presentationBackground(.clear)
                    }
                }
        }
    }
}
