import SwiftUI
import UIKit

struct ZoomableImageView: UIViewRepresentable {
    let image: UIImage
    let accessibilityLabel: String
    let dragConfiguration: ZoomableImageDragConfiguration?

    init(
        image: UIImage,
        accessibilityLabel: String,
        dragConfiguration: ZoomableImageDragConfiguration? = nil
    ) {
        self.image = image
        self.accessibilityLabel = accessibilityLabel
        self.dragConfiguration = dragConfiguration
    }

    func makeUIView(context: Context) -> ZoomingImageScrollView {
        let view = ZoomingImageScrollView()
        view.isDragEnabled = dragConfiguration != nil
        view.dragHandler = context.coordinator
        view.setImage(image, accessibilityLabel: accessibilityLabel)
        return view
    }

    func updateUIView(_ view: ZoomingImageScrollView, context: Context) {
        context.coordinator.dragConfiguration = dragConfiguration
        view.isDragEnabled = dragConfiguration != nil
        view.dragHandler = context.coordinator
        view.setImage(image, accessibilityLabel: accessibilityLabel)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(dragConfiguration: dragConfiguration)
    }

    final class Coordinator: ZoomingImageScrollViewDragHandling {
        var dragConfiguration: ZoomableImageDragConfiguration?

        init(dragConfiguration: ZoomableImageDragConfiguration?) {
            self.dragConfiguration = dragConfiguration
        }

        func zoomingImageScrollViewDidChangeDrag(_ translation: CGSize) {
            dragConfiguration?.onChanged(translation)
        }

        func zoomingImageScrollViewDidEndDrag(_ translation: CGSize) {
            dragConfiguration?.onEnded(translation)
        }

        func zoomingImageScrollViewDidCancelDrag() {
            dragConfiguration?.onCancelled()
        }
    }
}

struct ZoomableImageDragConfiguration {
    let onChanged: (CGSize) -> Void
    let onEnded: (CGSize) -> Void
    let onCancelled: () -> Void
}

protocol ZoomingImageScrollViewDragHandling: AnyObject {
    func zoomingImageScrollViewDidChangeDrag(_ translation: CGSize)
    func zoomingImageScrollViewDidEndDrag(_ translation: CGSize)
    func zoomingImageScrollViewDidCancelDrag()
}

final class ZoomingImageScrollView: UIView, UIScrollViewDelegate, UIGestureRecognizerDelegate {
    private let scrollView = UIScrollView()
    private let imageView = UIImageView()

    private var currentImage: UIImage?
    private var lastBoundsSize: CGSize = .zero
    private lazy var dismissalPanGestureRecognizer = UIPanGestureRecognizer(
        target: self,
        action: #selector(handleDismissalPan(_:))
    )

    var isDragEnabled = false
    weak var dragHandler: ZoomingImageScrollViewDragHandling?

    override init(frame: CGRect) {
        super.init(frame: frame)
        configureSubviews()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configureSubviews()
    }

    func setImage(_ image: UIImage, accessibilityLabel: String) {
        guard currentImage !== image else {
            imageView.accessibilityLabel = accessibilityLabel
            return
        }

        currentImage = image
        imageView.image = image
        imageView.accessibilityLabel = accessibilityLabel
        imageView.frame = CGRect(origin: .zero, size: image.size)
        scrollView.contentSize = image.size
        configureZoom(reset: true)
    }

    override func layoutSubviews() {
        super.layoutSubviews()

        scrollView.frame = bounds
        let didChangeSize = lastBoundsSize != bounds.size
        lastBoundsSize = bounds.size
        configureZoom(reset: didChangeSize)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? {
        imageView
    }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        centerImage()
    }

    private func configureSubviews() {
        backgroundColor = .clear
        scrollView.backgroundColor = .clear
        scrollView.delegate = self
        scrollView.bouncesZoom = true
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.showsVerticalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never

        imageView.contentMode = .scaleAspectFit
        imageView.isAccessibilityElement = true
        imageView.isUserInteractionEnabled = true

        dismissalPanGestureRecognizer.delegate = self
        dismissalPanGestureRecognizer.maximumNumberOfTouches = 1
        dismissalPanGestureRecognizer.cancelsTouchesInView = false

        addSubview(scrollView)
        scrollView.addSubview(imageView)
        imageView.addGestureRecognizer(dismissalPanGestureRecognizer)
        scrollView.panGestureRecognizer.require(toFail: dismissalPanGestureRecognizer)
    }

    private func configureZoom(reset: Bool) {
        guard let image = currentImage,
              bounds.width > 0,
              bounds.height > 0,
              image.size.width > 0,
              image.size.height > 0 else {
            return
        }

        let fitScale = min(bounds.width / image.size.width, bounds.height / image.size.height)
        let minimumScale = fitScale
        let maximumScale = max(fitScale * 4, fitScale + 1)

        scrollView.minimumZoomScale = minimumScale
        scrollView.maximumZoomScale = maximumScale

        if reset || scrollView.zoomScale < minimumScale || scrollView.zoomScale > maximumScale {
            scrollView.zoomScale = minimumScale
        }

        centerImage()
    }

    private func centerImage() {
        let scaledWidth = imageView.bounds.width * scrollView.zoomScale
        let scaledHeight = imageView.bounds.height * scrollView.zoomScale
        let horizontalInset = max((bounds.width - scaledWidth) / 2, 0)
        let verticalInset = max((bounds.height - scaledHeight) / 2, 0)

        scrollView.contentInset = UIEdgeInsets(
            top: verticalInset,
            left: horizontalInset,
            bottom: verticalInset,
            right: horizontalInset
        )
    }

    @objc private func handleDismissalPan(_ recognizer: UIPanGestureRecognizer) {
        let point = recognizer.translation(in: self)
        let translation = CGSize(width: point.x, height: point.y)

        switch recognizer.state {
        case .began, .changed:
            dragHandler?.zoomingImageScrollViewDidChangeDrag(translation)
        case .ended:
            dragHandler?.zoomingImageScrollViewDidEndDrag(translation)
        case .cancelled, .failed:
            dragHandler?.zoomingImageScrollViewDidCancelDrag()
        case .possible:
            break
        @unknown default:
            dragHandler?.zoomingImageScrollViewDidCancelDrag()
        }
    }

    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === dismissalPanGestureRecognizer else {
            return true
        }

        return isDragEnabled && scrollView.zoomScale <= scrollView.minimumZoomScale + 0.01
    }
}
