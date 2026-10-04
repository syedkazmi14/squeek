import SqueekCore
import ReplayKit
import SwiftUI

/// The system's broadcast picker, started from a Squeek button. iOS only lets a person start a screen
/// broadcast through its own picker, so this embeds one, invisibly, and presses it for them.
struct StartScreenGuardButton: View {
  @State private var picker = BroadcastPickerHandle()

  var body: some View {
    Button("Start Screen Guard") { picker.press() }
      .primaryAction()
      .background(BroadcastPicker(handle: picker).frame(width: 1, height: 1).opacity(0.01))
  }
}

final class BroadcastPickerHandle {
  fileprivate weak var view: RPSystemBroadcastPickerView?

  func press() {
    view?.subviews.compactMap { $0 as? UIButton }.first?.sendActions(for: .touchUpInside)
  }
}

private struct BroadcastPicker: UIViewRepresentable {
  let handle: BroadcastPickerHandle

  func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
    let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
    picker.preferredExtension = ScreenGuardInfo.extensionBundleId
    picker.showsMicrophoneButton = false
    handle.view = picker
    return picker
  }

  func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {}
}

enum ScreenGuardInfo {
  /// The broadcast extension the picker offers. Read from Info.plist so a build can point at the
  /// extension under a different, already-registered bundle id (see scripts/device-build.sh).
  static var extensionBundleId: String {
    (Bundle.main.object(forInfoDictionaryKey: "SqueekScreenGuardBundleId") as? String).flatMap { $0.isEmpty ? nil : $0 }
      ?? SqueekConfig.appBundleId + ".ScreenGuard"
  }
}

/// The Screen Guard steps in the setup list: what it does, what it keeps, and the start button.
struct ScreenGuardActions: View {
  @EnvironmentObject private var model: AppModel

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if model.screenGuardOn {
        Label("Screen Guard is running. Stop it any time from the red bar or Control Center.", systemImage: "checkmark.circle.fill")
          .font(.nunito(.subheadline, .semibold))
          .foregroundStyle(Theme.safe)
        if let status = model.screenGuardStatus {
          Text(lastLook(status))
            .font(.nunito(.footnote))
            .foregroundStyle(Theme.secondaryInk)
            .fixedSize(horizontal: false, vertical: true)
        }
      } else {
        StartScreenGuardButton()
      }
    }
    .task {
      // The person goes to the system picker and comes back, so watch for the broadcast to start.
      while !Task.isCancelled {
        await model.refreshProtectionStatus()
        try? await Task.sleep(for: .seconds(2))
      }
    }
  }

  /// "Last looked 12 seconds ago and read 318 characters: no scam signs." So it's clear whether it's reading.
  private func lastLook(_ status: ScreenGuardStatus) -> String {
    guard let result = status.lastResult else { return "Waiting for the first look. It looks about every 30 seconds." }
    let ago = Int(Date().timeIntervalSince(status.lastFrameAt))
    let when = ago < 5 ? "just now" : "\(ago) seconds ago"
    let read = (status.lastCharacters ?? 0) > 0 ? " and read \(status.lastCharacters ?? 0) characters" : ""
    let outcome: String
    switch result {
    case "clear": outcome = "no scam signs found."
    case "caution": outcome = "this may be a scam, so I warned you."
    case "danger": outcome = "that looked like a scam. Check your notifications and Activity."
    case "own_screen": outcome = "skipped, that was a Squeek screen."
    case "little_text": outcome = "too little text to judge."
    case "no_rules": outcome = "setup problem: the scam rules are missing."
    default: outcome = "couldn't read the screen."
    }
    let signs = (status.lastSigns ?? []).isEmpty ? "" : " Noticed: " + (status.lastSigns ?? []).joined(separator: "; ") + "."
    return "Last looked \(when)\(read): \(outcome)\(signs) (\(status.looks ?? 0) looks so far)"
  }
}
