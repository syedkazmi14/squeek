import ActivityKit
import Foundation

/// Keeps one Squeek Live Activity running, so the mascot sits in the Dynamic Island (and on the Lock
/// Screen) whenever the app is in the background. Live Activities must be started while the app is
/// in the foreground, so this is called when the app becomes active.
@MainActor
enum LiveActivityController {
  static func startOrUpdate(protectionsOn: Int, protectionsTotal: Int) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    let state = SqueekActivityAttributes.ContentState(protectionsOn: protectionsOn, protectionsTotal: protectionsTotal)
    let content = ActivityContent(state: state, staleDate: nil)

    if let running = Activity<SqueekActivityAttributes>.activities.first {
      Task { await running.update(content) }
      return
    }
    do {
      _ = try Activity.request(attributes: SqueekActivityAttributes(), content: content, pushType: nil)
    } catch {
      // The user turned Live Activities off for Squeek, or too many are running. Nothing to do.
    }
  }

  static func end() {
    for activity in Activity<SqueekActivityAttributes>.activities {
      Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }
  }
}
