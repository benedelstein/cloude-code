import SwiftUI

extension View {
    func readSize(_ onChange: @escaping (CGSize) -> Void) -> some View {
        onGeometryChange(for: CGSize.self) { proxy in
            proxy.size
        } action: { size in
            onChange(size)
        }
    }
}
