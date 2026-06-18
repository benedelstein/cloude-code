import Domain
import SwiftUI

@Observable
private class UpdateCounter {
    @ObservationIgnored var updateCount: Int = 1
}

@ViewBuilder func randomColorView() -> some View {
    #if DEBUG
        let colors: [Color] = [.red, .blue, .green, .orange, .pink, .white, .gray, .cyan, .black, .yellow, .purple]
        colors.randomElement() ?? .red
    #else
        EmptyView()
    #endif
}

struct UpdateDebugModifier: ViewModifier {
    @State private var counter: UpdateCounter = UpdateCounter()

    var name: String?
    var offset: CGSize = .zero
    private var id: UUID = UUID()
    var alignment: Alignment = .center

    init(name: String? = nil, offset: CGSize = .zero, id: UUID = .init(), alignment: Alignment = .center) {
        self.name = name
        self.offset = offset
        self.id = id
        self.alignment = alignment
    }

    func body(content: Content) -> some View {
        DispatchQueue.main.async {
            counter.updateCount += 1
        }

        return content
            .overlay(alignment: alignment) {
                #if DEBUG
                HStack {
                    if let name {
                        Text("\(name): \(counter.updateCount)")
                    } else {
                        Text("\(counter.updateCount)")
                    }

                    randomColorView()
                        .frame(width: 20, height: 20)
                        .border(.white)
                }
                .padding(4)
                .foregroundColor(.white)
                .background(.black)
                .offset(offset)
                #endif
            }
    }
}

public extension View {
    func debugUpdates(name: String? = nil, offset: CGSize = .zero) -> some View {
        modifier(UpdateDebugModifier(name: name, offset: offset))
    }
}
