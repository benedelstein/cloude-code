import SwiftUI
import UIKit

struct ZoomableImageView: UIViewRepresentable {
    let image: UIImage
    let accessibilityLabel: String

    func makeUIView(context: Context) -> ZoomingImageScrollView {
        let view = ZoomingImageScrollView()
        view.setImage(image, accessibilityLabel: accessibilityLabel)
        return view
    }

    func updateUIView(_ view: ZoomingImageScrollView, context: Context) {
        view.setImage(image, accessibilityLabel: accessibilityLabel)
    }
}

final class ZoomingImageScrollView: UIView, UIScrollViewDelegate {
    private let scrollView = UIScrollView()
    private let imageView = UIImageView()

    private var currentImage: UIImage?
    private var lastBoundsSize: CGSize = .zero

    override init(frame: CGRect) {
        super.init(frame: frame)
        configureSubviews()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configureSubviews()
    }

    func setImage(_ image: UIImage, accessibilityLabel: String) {
        let didChangeImage = currentImage !== image
        currentImage = image
        imageView.image = image
        imageView.accessibilityLabel = accessibilityLabel
        imageView.frame = CGRect(origin: .zero, size: image.size)
        scrollView.contentSize = image.size
        configureZoom(reset: didChangeImage)
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

        addSubview(scrollView)
        scrollView.addSubview(imageView)
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
}
