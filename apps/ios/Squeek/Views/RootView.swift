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
    // Above everything, so it shows even while sign-in is still restoring.
    .fullScreenCover(item: $model.pause) { pause in PaymentPauseView(pause: pause) }
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
  @AppStorage("squeek.onboarded") private var onboarded = false

  private var unreviewed: Int {
    model.incidents.filter { $0.level == .danger && $0.userAction == nil }.count
  }

  var body: some View {
    TabView(selection: $model.selectedTab) {
      Tab("Home", systemImage: "house.fill", value: AppTab.home) {
        NavigationStack { HomeView() }
      }
      Tab("Activity", systemImage: "list.bullet.rectangle.fill", value: AppTab.activity) {
        NavigationStack { ActivityView() }
      }
      .badge(unreviewed)
      Tab("My Person", systemImage: "person.2.fill", value: AppTab.person) {
        NavigationStack { MyPersonView() }
      }
    }
    .fullScreenCover(
      isPresented: Binding(get: { !onboarded && !model.isDemo }, set: { if !$0 { onboarded = true } })
    ) {
      NavigationStack { GuardSetupView(isOnboarding: true) }
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
