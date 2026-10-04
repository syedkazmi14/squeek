import BackgroundTasks
import Foundation
import UIKit
import UserNotifications

/// Local and remote notifications.
enum Notifications {
  static func requestPermission() async -> Bool {
    let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    if granted {
      await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
    }
    return granted
  }

  static func isAuthorized() async -> Bool {
    await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .authorized
  }

  static func post(title: String, body: String) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request)
  }
}

/// Periodic refresh so the call block list stays current even if the app isn't opened.
enum BackgroundRefresh {
  static var identifier: String { ClickeyConfig.appBundleId + ".refresh" }

  static func schedule() {
    let request = BGAppRefreshTaskRequest(identifier: identifier)
    request.earliestBeginDate = Date(timeIntervalSinceNow: 4 * 3600)
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
    Task { @MainActor in
      if await Notifications.isAuthorized() { application.registerForRemoteNotifications() }
    }
    return true
  }

  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    Task { @MainActor in AppModel.shared.setAPNSToken(token) }
  }

  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    print("Push registration failed: \(error.localizedDescription)")
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .sound, .list]
  }
}
