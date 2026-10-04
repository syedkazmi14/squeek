import SwiftUI

@main
struct SqueekApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @StateObject private var model = AppModel.shared
  @Environment(\.scenePhase) private var scenePhase

  init() { Theme.registerFonts() }

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
          LiveActivityController.startOrUpdate(protectionsOn: model.protectionsOn, protectionsTotal: model.protectionsTotal)
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
