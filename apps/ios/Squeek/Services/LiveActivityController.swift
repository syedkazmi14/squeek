import ActivityKit
import Foundation

/// Keeps one Squeek Live Activity running, so the mascot sits in the Dynamic Island (and on the Lock
/// Screen) whenever the app is in the background. Live Activities must be started while the app is
/// in the foreground, so this is called when the app becomes active.
@MainActor
enum LiveActivityController {
  static func startOrUpdate(protectionsOn: Int, protectionsTotal: Int, warning: String? = nil, warningDate: Date? = nil) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    let state = SqueekActivityAttributes.ContentState(
      protectionsOn: protectionsOn, protectionsTotal: protectionsTotal, warning: warning, warningDate: warningDate)
    let content = ActivityContent(state: state, staleDate: nil)

    if let running = Activity<SqueekActivityAttributes>.activities.first {
      // A new warning lights up the Dynamic Island briefly, like an incoming call would.
      let alert = warning != nil && running.content.state.warning == nil
        ? AlertConfiguration(title: "Squeek", body: "\(warning ?? "")", sound: .default) : nil
      Task { await running.update(content, alertConfiguration: alert) }
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
