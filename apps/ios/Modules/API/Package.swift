// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "API",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(
            name: "API",
            targets: ["API"]
        )
    ],
    targets: [
        .target(name: "API")
    ]
)
