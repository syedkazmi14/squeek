import SwiftUI

/// One protection per card, in plain steps. iOS only lets the person switch these on in Settings,
/// so each card says exactly where to go.
struct SetupGuideView: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.dismiss) private var dismiss
  @State private var notificationsOn = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text("Turn these on once. Clickey then works in the background.")
          .font(.title3)

        step(
          "Block scam calls", done: model.callBlockingStatus == .enabled,
          steps: ["Open Settings › Apps › Phone › Call Blocking & Identification.", "Turn on Clickey."]
        ) {
          Button("Open call settings") { CallDirectorySync.openSettings() }
            .buttonStyle(PrimaryButtonStyle())
        }

        step(
          "Filter scam texts", done: nil,
          steps: [
            "Open Settings › Apps › Messages › Unknown & Spam.",
            "Under SMS Filtering, choose Clickey.",
            "Clickey checks texts from numbers that aren't in your contacts and moves likely scams to Junk. It can't read iMessages or texts from your contacts.",
          ]
        ) {
          Button("Open Settings") { SystemSettings.open() }
            .buttonStyle(SecondaryButtonStyle())
        }

        step(
          "Warnings in Safari", done: nil,
          steps: [
            "Open Settings › Apps › Safari › Extensions › Clickey.",
            "Turn it on, then set All Websites to Allow.",
            "Clickey then warns you before a dangerous link opens in Safari.",
          ]
        ) {
          Button("Open Settings") { SystemSettings.open() }
            .buttonStyle(SecondaryButtonStyle())
        }

        step(
          "Block dangerous websites everywhere", done: model.protectiveDNSEnabled,
          steps: [
            "Tap Install below and allow it.",
            "Open Settings › General › VPN & Device Management › DNS and choose Clickey protective DNS.",
            "Known dangerous websites then won't load in any app. This uses Cloudflare's free malware-blocking service.",
          ]
        ) {
          Button("Install") { Task { await model.setProtectiveDNS(true) } }
            .buttonStyle(PrimaryButtonStyle())
        }

        step(
          "Family alerts", done: notificationsOn,
          steps: ["Allow notifications so Clickey can tell you when your computer or someone you help gets a scam warning."]
        ) {
          Button("Allow notifications") {
            Task { notificationsOn = await Notifications.requestPermission() }
          }
          .buttonStyle(SecondaryButtonStyle())
        }

        step(
          "One-press screenshot check (optional)", done: nil,
          steps: [
            "Open the Shortcuts app and make a new shortcut.",
            "Add \"Take Screenshot\", then add Clickey's \"Check a Screenshot\".",
            "In Settings › Accessibility › Touch › Back Tap, choose that shortcut for Double Tap.",
            "Now tapping the back of your iPhone twice checks what's on screen.",
          ]
        ) { EmptyView() }
      }
      .padding(20)
    }
    .screenBackground()
    .navigationTitle("Set up protections")
    .task {
      await model.refreshProtectionStatus()
      notificationsOn = await Notifications.isAuthorized()
    }
  }

  private func step<Actions: View>(
    _ title: String, done: Bool?, steps: [String], @ViewBuilder actions: () -> Actions
  ) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(title).font(.title2.weight(.semibold))
        Spacer()
        if let done {
          Label(done ? "On" : "Off", systemImage: done ? "checkmark.circle.fill" : "circle.dashed")
            .foregroundStyle(done ? Theme.forest : Theme.secondaryInk)
            .font(.headline)
        }
      }
      ForEach(Array(steps.enumerated()), id: \.offset) { index, text in
        HStack(alignment: .top, spacing: 10) {
          Text("\(index + 1).").font(.title3.monospacedDigit()).foregroundStyle(Theme.secondaryInk)
          Text(text).font(.title3).fixedSize(horizontal: false, vertical: true)
        }
      }
      actions()
    }
    .card()
  }
}
