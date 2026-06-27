//
//  Environment+Haptics.swift
//  CloudeCode
//
//  Created by Ben Edelstein on 6/23/26.
//
import SwiftUI

extension EnvironmentValues {
    @Entry
    var lightFeedback: UIImpactFeedbackGenerator = .init(style: .light)

    @Entry
    var regularFeedback: UIImpactFeedbackGenerator = .init(style: .medium)

    @Entry
    var softFeedback: UIImpactFeedbackGenerator = .init(style: .soft)

    @Entry
    var notificationFeedback: UINotificationFeedbackGenerator = .init()

    @Entry
    var selectionFeedback: UISelectionFeedbackGenerator = .init()
}
