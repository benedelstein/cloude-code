//
//  View+frame.swift
//  CloudeCode
//
//  Created by Ben Edelstein on 6/25/26.
//

import SwiftUI

extension View {
    func frame(size: CGSize, alignment: Alignment = .center) -> some View {
        frame(width: size.width, height: size.height, alignment: alignment)
    }

    func squareFrame(size: CGFloat, alignment: Alignment = .center) -> some View {
        frame(width: size, height: size, alignment: alignment)
    }
}
