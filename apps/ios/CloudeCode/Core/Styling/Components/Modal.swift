//
//  Modal.swift
//  CloudeCode
//
//  Created by Ben Edelstein on 6/16/26.
//
import SwiftUI

public struct Modal<Destination: Identifiable>: Identifiable {
    public enum ModalType: String, Hashable, Identifiable {
        case sheet, fullscreen

        public var id: Self { self }
    }

    public let type: ModalType
    public let destination: Destination

    public init(type: ModalType, destination: Destination) {
        self.type = type
        self.destination = destination
    }

    public var id: String {
        "\(type)_\(destination.id)"
    }

    public static func sheet(_ destination: Destination) -> Self {
        .init(type: .sheet, destination: destination)
    }

    public static func fullscreen(_ destination: Destination) -> Self {
        .init(type: .fullscreen, destination: destination)
    }
}

public extension View {
    func withModal<Destination: Identifiable, Content: View>(
        _ modalBinding: Binding<Modal<Destination>?>,
        @ViewBuilder content: @escaping (Destination) -> Content
    ) -> some View {
        self
            .sheet(
                item: Binding<Modal?>(get: {
                    guard let modal = modalBinding.wrappedValue, modal.type == .sheet else {
                        return nil
                    }
                    return modal
                }, set: { newValue, _ in
                    modalBinding.wrappedValue = newValue
                })
            ) { item in
                content(item.destination)
            }
            .fullScreenCover(
                item: Binding<Modal?>(get: {
                    guard let modal = modalBinding.wrappedValue, modal.type == .fullscreen else {
                        return nil
                    }
                    return modal
                }, set: { newValue, _ in
                    modalBinding.wrappedValue = newValue
                })
            ) { item in
                content(item.destination)
            }
    }
}
