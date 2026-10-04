import SwiftUI

@main
struct ClickeyApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @StateObject private var model = AppModel.shared
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(model)
        .onAppear { model.start() }
        .onOpenURL { model.handleOpenURL($0) }
    }
    .onChange(of: scenePhase) { _, phase in
      switch phase {
      case .active:
        Task {
          await model.refreshAll()
          await model.refreshProtectionStatus()
        }
      case .background:
        BackgroundRefresh.schedule()
      default:
        break
      }
    }
    .backgroundTask(.appRefresh(BackgroundRefresh.identifier)) {
      await AppModel.shared.backgroundRefresh()
    }
  }
}
