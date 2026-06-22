//
//  ScrollController.swift
//  CloudeCode
//
//  Created by Ben Edelstein on 6/19/26.
//
import SwiftUI
import Combine

@Observable
final class ScrollController: NSObject {
    // NOTE: THESE ARE NOT OBSERVED BECAUSE THEY UPDATE OFTEN
    @ObservationIgnored
    weak var scrollView: UIScrollView?
    @ObservationIgnored
    @Published private(set) public var contentOffset: CGPoint?
    @ObservationIgnored
    private(set) public var previousContentOffset: CGPoint?
    @ObservationIgnored
    private(set) public var contentSize: CGSize?

    public func update(with scrollView: UIScrollView) {
        if self.scrollView !== scrollView {
            self.scrollView = scrollView
        }
        if scrollView.delegate !== self {
            scrollView.delegate = self
        }

        previousContentOffset = contentOffset
        contentOffset = scrollView.contentOffset
        contentSize = scrollView.contentSize
    }

    public func updateKeyboardDismissPadding(_ padding: CGFloat) {
        guard let scrollView else { return }
        scrollView.keyboardDismissMode = .interactive
        guard scrollView.keyboardLayoutGuide.keyboardDismissPadding != padding else { return }
        scrollView.keyboardLayoutGuide.keyboardDismissPadding = padding
    }
}

extension ScrollController: UIScrollViewDelegate {
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        self.update(with: scrollView)
    }
}
