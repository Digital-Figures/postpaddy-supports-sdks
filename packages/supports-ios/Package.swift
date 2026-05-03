// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "PostpaddySupports",
  platforms: [.iOS(.v15), .macOS(.v12)],
  products: [
    .library(name: "PostpaddySupports", targets: ["PostpaddySupports"]),
  ],
  targets: [
    .target(name: "PostpaddySupports", path: "Sources/PostpaddySupports"),
  ]
)
