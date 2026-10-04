import SwiftUI

/// One card per guard with plain steps. Shown on first launch, and from Home for a guard that's off.
/// iOS only lets the person switch most of these on in Settings, so Squeek can't always see them;
/// those cards have "I've done this" to tick off.
struct GuardSetupView: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.openURL) private var openURL
  @Environment(\.dismiss) private var dismiss
  /// The card to open first. Without one, the first guard that's off opens.
  var focus: SqueekGuard?
  var isOnboarding = false
  @State private var expanded: SqueekGuard?

  var body: some View {
    let done = model.protectionsOn
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        VStack(alignment: .leading, spacing: 10) {
          Text(isOnboarding ? "Let's set up Squeek" : "\(done) of \(model.protectionsTotal) on")
            .font(.display(.title))
            .foregroundStyle(Theme.ink)
            .contentTransition(.numericText(value: Double(done)))
          Text("Turn each one on once. Squeek then looks out for you in the background, without you opening the app.")
            .font(.nunito(.body))
            .foregroundStyle(Theme.secondaryInk)
            .fixedSize(horizontal: false, vertical: true)
          ProgressView(value: Double(done), total: Double(model.protectionsTotal))
            .tint(Theme.accent)
            .scaleEffect(x: 1, y: 2, anchor: .center)
        }
        .card(padding: 20)

        card(.calls, lines: [
          "Block known scam callers: open Settings › Apps › Phone › Call Blocking & Identification, and turn on Squeek.",
          "Allow notifications, so Squeek can also tell you on screen.",
        ]) {
          if model.callBlockingStatus != .enabled {
            Button("Open call settings") { CallDirectorySync.openSettings() }.primaryAction()
          }
          if !model.notificationsOn {
            Button("Allow notifications") {
              Task {
                _ = await Notifications.requestPermission()
                await model.refreshProtectionStatus()
              }
            }
            .secondaryAction()
          }
          CallScreeningSetup()
        }

        card(.texts, manual: $model.textsGuardOn, lines: [
          "Open Settings › Apps › Messages › Unknown & Spam.",
          "Under SMS Filtering, choose Squeek.",
          "Likely scams from unknown numbers go to Junk. Squeek never sees iMessages or texts from your contacts.",
        ]) {
          Button("Open Settings") { SystemSettings.open() }.secondaryAction()
        }

        card(.web, manual: $model.webGuardOn, lines: [
          "Open Settings › Apps › Safari › Extensions › Squeek. Turn it on and set All Websites to Allow.",
          "Then tap Get the profile, open Settings, tap Profile Downloaded and Install. Known dangerous sites then won't load in any app.",
        ]) {
          Button("Open Settings") { SystemSettings.open() }.secondaryAction()
          if let url = SqueekConfig.dnsProfileURL {
            Button("Get the profile") { openURL(url) }.secondaryAction()
          }
        }

        card(.person, lines: [
          "Pick a family member or friend you trust.",
          "When something looks like a scam, they can help you check, and you can ask them with one tap.",
        ]) {
          Button("Choose my person") {
            model.selectedTab = .person
            dismiss()
          }
          .primaryAction()
        }
      }
      .padding(Theme.pagePadding)
    }
    .scrollIndicators(.hidden)
    .screenBackground()
    .navigationTitle(isOnboarding ? "" : "Set up Squeek")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        Button(isOnboarding && done < model.protectionsTotal ? "Later" : "Done") { dismiss() }
      }
    }
    .task { await model.refreshProtectionStatus() }
    .onAppear { if expanded == nil { expanded = focus ?? SqueekGuard.allCases.first { !model.isOn($0) } } }
  }

  private func card<Actions: View>(
    _ item: SqueekGuard, manual: Binding<Bool>? = nil, lines: [String], @ViewBuilder actions: () -> Actions
  ) -> some View {
    let done = model.isOn(item)
    let isOpen = expanded == item
    return VStack(alignment: .leading, spacing: 14) {
      Button {
        withAnimation(.spring(duration: 0.35)) { expanded = isOpen ? nil : item }
      } label: {
        HStack(spacing: 14) {
          ZStack {
            Circle().fill(done ? Theme.accent : Theme.accentSoft)
            if done {
              Image(systemName: "checkmark").font(.headline.weight(.bold)).foregroundStyle(Theme.onAccent)
            } else {
              Image(systemName: item.symbol).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.accentInk)
            }
          }
          .frame(width: 42, height: 42)
          VStack(alignment: .leading, spacing: 2) {
            Text(item.title).font(.nunito(.headline)).foregroundStyle(Theme.ink)
            Text(done ? item.onSummary : item.offSummary)
              .font(.nunito(.subheadline))
              .foregroundStyle(done ? Theme.accentInk : Theme.secondaryInk)
          }
          Spacer()
          Image(systemName: "chevron.down")
            .font(.nunito(.subheadline, .bold))
            .foregroundStyle(Theme.secondaryInk)
            .rotationEffect(.degrees(isOpen ? 180 : 0))
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityValue(done ? "On" : "Off")

      if isOpen {
        VStack(alignment: .leading, spacing: 10) {
          ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
            HStack(alignment: .firstTextBaseline, spacing: 10) {
              Text("\(index + 1)").font(.nunito(.subheadline, .bold).monospacedDigit()).foregroundStyle(Theme.accentInk)
              Text(line).font(.nunito(.body)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
            }
          }
          actions()
          if let manual {
            Toggle("I've done this", isOn: manual)
              .font(.nunito(.subheadline, .semibold))
              .tint(Theme.accent)
          }
        }
        .transition(.opacity.combined(with: .move(edge: .top)))
      }
    }
    .card(padding: 18)
  }
}
