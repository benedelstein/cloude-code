//
//  ComposerStyle.swift
//  CloudeCode
//
//  Created by Ben Edelstein on 6/25/26.
//

import SwiftUI

struct ComposerStyle {
    var contentInset: CGFloat = 8
    var bottomButtonSize: CGFloat = 32
    let photoPickerHeight: CGFloat = 350
}

extension EnvironmentValues {
    @Entry
    var composerStyle: ComposerStyle = .init()
}
