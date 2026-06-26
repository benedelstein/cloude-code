//
//  ComposerStyle.swift
//  CloudeCode
//
//  Created by Ben Edelstein on 6/25/26.
//

import SwiftUI

struct ComposerStyle {
    var horizontalPadding: CGFloat = 12
    var bottomButtonSize: CGFloat = 32
}

extension EnvironmentValues {
    @Entry
    var composerStyle: ComposerStyle = .init()
}
