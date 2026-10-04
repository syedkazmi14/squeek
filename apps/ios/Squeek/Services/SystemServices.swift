import BackgroundTasks
import Foundation
import UIKit
import UserNotifications

/// Local notifications. Squeek doesn't use push (it needs a paid developer account); new warnings
/// arrive over Realtime while the app runs and through Background App Refresh otherwise.
enum Notifications {
  static func requestPermission() async -> Bool {
    (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
  }

  static func isAuthorized() async -> Bool {
    await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .authorized
  }

  /// `opensActivity`: tapping the notification goes to the Activity tab, where the warning is.
  static func post(title: String, body: String, opensActivity: Bool = false) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    if opensActivity { content.userInfo = ["tab": "activity"] }
    let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request)
  }
}

/// Periodic refresh so the call block list stays current even if the app isn't opened.
enum BackgroundRefresh {
  static var identifier: String { SqueekConfig.appBundleId + ".refresh" }

  static func schedule() {
    let request = BGAppRefreshTaskRequest(identifier: identifier)
    // iOS decides the actual timing; this asks for roughly every 15 minutes at most.
    request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
    try? BGTaskScheduler.shared.submit(request)
  }
}

enum DeviceInfo {
  @MainActor static var name: String { UIDevice.current.name }
}

enum SystemSettings {
  @MainActor static func open() {
    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
  }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(
    _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return true
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .sound, .list]
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    guard response.notification.request.content.userInfo["tab"] as? String == "activity" else { return }
    await MainActor.run { AppModel.shared.selectedTab = .activity }
  }
}
