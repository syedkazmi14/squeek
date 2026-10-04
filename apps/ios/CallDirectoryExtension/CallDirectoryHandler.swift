import CallKit
import ClickeyCore
import Foundation

/// Hands iOS the numbers to block and to label on the incoming-call screen.
/// The app writes the list to the App Group (see AppModel.publishToExtensions) and asks iOS to reload.
final class CallDirectoryHandler: CXCallDirectoryProvider {
  override func beginRequest(with context: CXCallDirectoryExtensionContext) {
    context.delegate = self
    let appGroup = (Bundle.main.object(forInfoDictionaryKey: "ClickeyAppGroup") as? String) ?? ""
    let snapshot = SharedStore(appGroup: appGroup)?.blockList() ?? .empty
    let plan = CallDirectoryPlan.make(snapshot)

    // Always send the full list; it's small, and a full reload can't drift out of step.
    if context.isIncremental {
      context.removeAllBlockingEntries()
      context.removeAllIdentificationEntries()
    }
    for number in plan.blocking {
      context.addBlockingEntry(withNextSequentialPhoneNumber: number)
    }
    for entry in plan.identification {
      context.addIdentificationEntry(withNextSequentialPhoneNumber: entry.number, label: entry.label)
    }
    context.completeRequest()
  }
}

extension CallDirectoryHandler: CXCallDirectoryExtensionContextDelegate {
  func requestFailed(for extensionContext: CXCallDirectoryExtensionContext, withError error: Error) {
    // Usually unsorted or duplicate numbers; CallDirectoryPlan prevents both.
    NSLog("Clickey call directory request failed: %@", error.localizedDescription)
  }
}
