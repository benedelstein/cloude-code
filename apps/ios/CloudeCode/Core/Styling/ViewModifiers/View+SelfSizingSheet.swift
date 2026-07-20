import SwiftUI

extension View {
    /// Sizes a presented sheet to its content and animates subsequent height changes.
    func selfSizingSheet(
        initialHeightEstimate: CGFloat,
        extraDetents: Set<PresentationDetent> = []
    ) -> some View {
        modifier(SelfSizingSheetModifier(
            initialHeightEstimate: initialHeightEstimate,
            extraDetents: extraDetents
        ))
    }
}

private struct SelfSizingSheetModifier: ViewModifier {
    @State private var currentHeight: CGFloat
    @State private var detents: Set<PresentationDetent>
    @State private var selectedDetent: PresentationDetent
    @State private var transitionID: UInt = 0
    @State private var heightUpdateID: UInt = 0

    private let extraDetents: Set<PresentationDetent>

    init(
        initialHeightEstimate: CGFloat,
        extraDetents: Set<PresentationDetent>
    ) {
        let initialDetent = PresentationDetent.height(initialHeightEstimate)

        self.extraDetents = extraDetents
        _currentHeight = State(initialValue: initialHeightEstimate)
        _detents = State(initialValue: extraDetents.union([initialDetent]))
        _selectedDetent = State(initialValue: initialDetent)
    }

    func body(content: Content) -> some View {
        content
            .readSize { size in
                let newHeight = size.height
                guard newHeight > 0, abs(newHeight - currentHeight) > 0.5 else { return }

                heightUpdateID &+= 1

                applyHeightUpdate(newHeight)
            }
            .presentationDetents(detents, selection: $selectedDetent)
    }

    private func applyHeightUpdate(_ newHeight: CGFloat) {
        guard newHeight > 0, abs(newHeight - currentHeight) > 0.5 else { return }

        currentHeight = newHeight
        animateDetentTransition(to: .height(newHeight))
    }

    /// Inserts the target before selecting it so SwiftUI can animate between valid detents.
    private func animateDetentTransition(to target: PresentationDetent) {
        transitionID &+= 1
        let currentTransitionID = transitionID

        detents.insert(target)

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            guard transitionID == currentTransitionID else { return }
            withAnimation {
                selectedDetent = target
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            guard transitionID == currentTransitionID else { return }
            // remove the old detent
            detents = extraDetents.union([target])
        }
    }
}
