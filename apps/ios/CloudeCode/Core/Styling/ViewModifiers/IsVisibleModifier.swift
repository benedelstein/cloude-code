//
//  IsVisibleModifier.swift
//  CloudeCode
//
//  Created by Ben Edelstein on 6/20/26.
//
import SwiftUI

struct IsVisibleModifier: ViewModifier {
//    @Environment(\.mainWindowRect) var windowRect

    @State var action: (() -> Void)?

    func body(content: Content) -> some View {
        content.overlay {
            GeometryReader { proxy in
                Color.clear
                    .preference(
                        key: VisibleKey.self,
                        value: (UIApplication.shared.activeKeyWindow?.frame ?? .zero)
                            .intersects(proxy.frame(in: .global))
                    )
                    .onPreferenceChange(VisibleKey.self) { isVisible in
                        guard isVisible, let action else { return }
                        action()
                    }
            }
        }
    }

    struct VisibleKey: PreferenceKey {
        static var defaultValue: Bool = false

        static func reduce(value: inout Bool, nextValue: () -> Bool) { }
    }
}
