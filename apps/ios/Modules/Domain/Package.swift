// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Domain",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [
        .library(
            name: "Domain",
            targets: ["Domain"]
        )
    ],
    targets: [
        .target(name: "Domain")
    ]
)
