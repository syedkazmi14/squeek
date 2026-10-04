import SwiftUI

/// One card per protection with plain steps. iOS only lets the person switch most of these on in
/// Settings, so Squeek can't always see them; those cards have "I've done this" to tick off.
struct SetupGuideView: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.openURL) private var openURL
  @AppStorage("squeek.setup.texts") private var textsDone = false
  @AppStorage("squeek.setup.safari") private var safariDone = false
  @AppStorage("squeek.setup.dns") private var dnsDone = false
  @State private var expanded: String?

  private var steps: [Bool] {
    [model.callBlockingStatus == .enabled, textsDone, safariDone, dnsDone, model.notificationsOn]
  }

  var body: some View {
    let done = steps.filter { $0 }.count
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        VStack(alignment: .leading, spacing: 10) {
          Text("\(done) of \(steps.count) done")
            .font(.display(.title))
            .foregroundStyle(Theme.ink)
            .contentTransition(.numericText(value: Double(done)))
          ProgressView(value: Double(done), total: Double(steps.count))
            .tint(Theme.accent)
            .scaleEffect(x: 1, y: 2, anchor: .center)
          Text("Turn each one on once. Squeek then works in the background.")
            .font(.nunito(.subheadline))
            .foregroundStyle(Theme.secondaryInk)
        }
        .card(padding: 20)

        step(
          id: "calls", number: 1, title: "Block scam calls", symbol: "phone.down.fill",
          done: model.callBlockingStatus == .enabled, manual: nil,
          lines: ["Open Settings › Apps › Phone › Call Blocking & Identification.", "Turn on Squeek."]
        ) {
          Button("Open call settings") { CallDirectorySync.openSettings() }.primaryAction()
        }

        step(
          id: "texts", number: 2, title: "Filter scam texts", symbol: "message.fill",
          done: textsDone, manual: $textsDone,
          lines: [
            "Open Settings › Apps › Messages › Unknown & Spam.",
            "Under SMS Filtering, choose Squeek.",
            "Squeek moves likely scams from unknown numbers to Junk. It can't read iMessages or texts from your contacts.",
          ]
        ) {
          Button("Open Settings") { SystemSettings.open() }.secondaryAction()
        }

        step(
          id: "safari", number: 3, title: "Warnings in Safari", symbol: "safari.fill",
          done: safariDone, manual: $safariDone,
          lines: [
            "Open Settings › Apps › Safari › Extensions › Squeek.",
            "Turn it on, then set All Websites to Allow.",
          ]
        ) {
          Button("Open Settings") { SystemSettings.open() }.secondaryAction()
        }

        step(
          id: "dns", number: 4, title: "Block dangerous websites", symbol: "globe",
          done: dnsDone, manual: $dnsDone,
          lines: [
            "Tap Get the profile, then Allow to download it.",
            "Open Settings, tap Profile Downloaded, then Install.",
            "Known dangerous websites then won't load in any app (Cloudflare's free malware-blocking service). Remove it any time in Settings › General › VPN & Device Management.",
          ]
        ) {
          if let url = SqueekConfig.dnsProfileURL {
            Button("Get the profile") { openURL(url) }.primaryAction()
          }
        }

        step(
          id: "alerts", number: 5, title: "Family alerts", symbol: "bell.badge.fill",
          done: model.notificationsOn, manual: nil,
          lines: [
            "Allow notifications so Squeek can tell you when your computer or someone you help gets a scam warning.",
            "Keep Background App Refresh on for Squeek (Settings › Apps › Squeek) so it can check while closed.",
          ]
        ) {
          Button("Allow notifications") {
            Task {
              _ = await Notifications.requestPermission()
              await model.refreshProtectionStatus()
            }
          }
          .primaryAction()
        }

        step(
          id: "shortcut", number: 6, title: "One-tap screenshot check", symbol: "hand.tap.fill",
          done: false, manual: nil, optional: true,
          lines: [
            "In the Shortcuts app, make a shortcut with “Take Screenshot”, then Squeek's “Check a Screenshot”.",
            "In Settings › Accessibility › Touch › Back Tap, choose it for Double Tap.",
            "Tapping the back of your iPhone twice then checks what's on screen.",
          ]
        ) { EmptyView() }
      }
      .padding(Theme.pagePadding)
    }
    .scrollIndicators(.hidden)
    .screenBackground()
    .navigationTitle("Set up protections")
    .navigationBarTitleDisplayMode(.inline)
    .task { await model.refreshProtectionStatus() }
  }

  private func step<Actions: View>(
    id: String, number: Int, title: String, symbol: String, done: Bool, manual: Binding<Bool>?,
    optional: Bool = false, lines: [String], @ViewBuilder actions: () -> Actions
  ) -> some View {
    let isOpen = expanded == id || (expanded == nil && !done && firstOpenStep == id)
    return VStack(alignment: .leading, spacing: 14) {
      Button {
        withAnimation(.spring(duration: 0.35)) { expanded = isOpen ? "" : id }
      } label: {
        HStack(spacing: 14) {
          ZStack {
            Circle().fill(done ? Theme.accent : Theme.accentSoft)
            if done {
              Image(systemName: "checkmark").font(.headline.weight(.bold)).foregroundStyle(Theme.onAccent)
            } else {
              Image(systemName: symbol).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.accentInk)
            }
          }
          .frame(width: 42, height: 42)
          VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.nunito(.headline)).foregroundStyle(Theme.ink)
            Text(done ? "Done" : optional ? "Optional" : "Step \(number)")
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
      .accessibilityValue(done ? "Done" : "Not done")

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

  private var firstOpenStep: String? {
    let ids = ["calls", "texts", "safari", "dns", "alerts"]
    return zip(ids, steps).first { !$0.1 }?.0
  }
}
