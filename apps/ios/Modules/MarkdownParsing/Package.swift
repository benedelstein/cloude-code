// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "MarkdownParsing",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [
        .library(
            name: "MarkdownParsing",
            targets: ["MarkdownParsing"]
        )
    ],
    dependencies: [
        .package(
            url: "https://github.com/swiftlang/swift-markdown",
            revision: "27b7fc1a19068bcea3d2072db0ce86360d1400ed"
        )
    ],
    targets: [
        .target(
            name: "MarkdownParsing",
            dependencies: [
                .product(name: "Markdown", package: "swift-markdown")
            ]
        ),
        .testTarget(
            name: "MarkdownParsingTests",
            dependencies: ["MarkdownParsing"]
        )
    ]
)
