// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Cache",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(
            name: "Cache",
            targets: ["Cache"]
        )
    ],
    targets: [
        .target(name: "Cache")
    ]
)
