import ActivityKit
import Foundation

/// The Live Activity that keeps Squeek's mascot in the Dynamic Island while the app is in the background.
/// Shared by the app (which starts it) and the widget extension (which draws it).
struct SqueekActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var protectionsOn: Int
    var protectionsTotal: Int
    /// While a likely scam is recent: "Pause before you pay anyone", and when it happened.
    var warning: String? = nil
    var warningDate: Date? = nil
  }
}
