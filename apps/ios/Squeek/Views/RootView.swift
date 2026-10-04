import SwiftUI

struct RootView: View {
  @EnvironmentObject private var model: AppModel
  @AppStorage("squeek.localOnly") private var localOnly = false

  var body: some View {
    Group {
      if model.showsAccountData || localOnly {
        MainTabs()
      } else {
        WelcomeView(continueWithoutAccount: { withAnimation { localOnly = true } })
      }
    }
    .tint(Theme.accentInk)
    .font(.nunito(.body))
    .minimumDynamicTypeSize(model.minimumTypeSize)
    .alert(
      "Something went wrong",
      isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })
    ) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(model.errorMessage ?? "")
    }
  }
}

struct MainTabs: View {
  @EnvironmentObject private var model: AppModel

  private var unreviewed: Int {
    model.incidents.filter { $0.level == .danger && $0.userAction == nil }.count
  }

  var body: some View {
    TabView(selection: $model.selectedTab) {
      Tab("Home", systemImage: "house.fill", value: AppTab.home) {
        NavigationStack { HomeView() }
      }
      Tab("Warnings", systemImage: "exclamationmark.triangle.fill", value: AppTab.warnings) {
        NavigationStack { HistoryView() }
      }
      .badge(unreviewed)
      Tab("Blocked", systemImage: "hand.raised.fill", value: AppTab.blocked) {
        NavigationStack { BlockedView() }
      }
      Tab("Family", systemImage: "person.2.fill", value: AppTab.family) {
        NavigationStack { FamilyView() }
      }
      Tab("Settings", systemImage: "gearshape.fill", value: AppTab.settings) {
        NavigationStack { SettingsView() }
      }
    }
  }
}

extension View {
  /// Applies the text size chosen in Squeek's settings as a minimum, on top of the system setting.
  @ViewBuilder
  func minimumDynamicTypeSize(_ size: DynamicTypeSize?) -> some View {
    if let size {
      dynamicTypeSize(size...DynamicTypeSize.accessibility5)
    } else {
      self
    }
  }

  /// Home draws its own header, so it hides the empty navigation bar.
  @ViewBuilder
  func hiddenNavigationBar() -> some View {
    #if os(iOS)
      toolbar(.hidden, for: .navigationBar)
    #else
      self
    #endif
  }
}

/// Gives custom tiles and rows a gentle press response.
struct PressableStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .opacity(configuration.isPressed ? 0.9 : 1)
      .animation(.spring(duration: 0.25), value: configuration.isPressed)
  }
}
