// swift-tools-version:5.9
import PackageDescription

// Platform-neutral Clickey logic shared by the app and every extension.
// Foundation only, so it also builds on macOS: `swift run ClickeyChecks` runs the golden fixtures.
let package = Package(
  name: "ClickeyCore",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [.library(name: "ClickeyCore", targets: ["ClickeyCore"])],
  targets: [
    .target(name: "ClickeyCore"),
    .executableTarget(name: "ClickeyChecks", dependencies: ["ClickeyCore"]),
  ]
)
