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
  static var extensionBundleId: String { SqueekConfig.appBundleId + ".ScreenGuard" }
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
}
