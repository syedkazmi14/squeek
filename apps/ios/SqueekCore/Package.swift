// swift-tools-version:5.9
import PackageDescription

// Platform-neutral Squeek logic shared by the app and every extension.
// Foundation only, so it also builds on macOS: `swift run SqueekChecks` runs the golden fixtures.
let package = Package(
  name: "SqueekCore",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [.library(name: "SqueekCore", targets: ["SqueekCore"])],
  targets: [
    .target(name: "SqueekCore"),
    .executableTarget(name: "SqueekChecks", dependencies: ["SqueekCore"]),
  ]
)
