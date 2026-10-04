import SwiftUI

struct RootView: View {
  @EnvironmentObject private var model: AppModel
  @AppStorage("clickey.localOnly") private var localOnly = false

  var body: some View {
    Group {
      if model.isSignedIn || localOnly {
        MainTabs()
      } else {
        WelcomeView(continueWithoutAccount: { localOnly = true })
      }
    }
    .tint(Theme.forest)
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
  var body: some View {
    TabView {
      NavigationStack { HomeView() }
        .tabItem { Label("Home", systemImage: "house") }
      NavigationStack { HistoryView() }
        .tabItem { Label("Warnings", systemImage: "exclamationmark.bubble") }
      NavigationStack { BlockedView() }
        .tabItem { Label("Blocked", systemImage: "hand.raised") }
      NavigationStack { FamilyView() }
        .tabItem { Label("Family", systemImage: "person.2") }
      NavigationStack { SettingsView() }
        .tabItem { Label("Settings", systemImage: "gearshape") }
    }
  }
}

extension View {
  /// Applies the text size chosen in Clickey's settings as a minimum, on top of the system setting.
  @ViewBuilder
  func minimumDynamicTypeSize(_ size: DynamicTypeSize?) -> some View {
    if let size {
      dynamicTypeSize(size...DynamicTypeSize.accessibility5)
    } else {
      self
    }
  }
}

extension View {
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

/// Page background used by every screen.
struct ScreenBackground: ViewModifier {
  func body(content: Content) -> some View {
    content
      .scrollContentBackground(.hidden)
      .background(Theme.ivory.ignoresSafeArea())
  }
}

extension View {
  func screenBackground() -> some View { modifier(ScreenBackground()) }
}
