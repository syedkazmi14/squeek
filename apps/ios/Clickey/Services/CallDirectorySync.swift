import CallKit
import Foundation

/// Talks to the Call Directory extension: reload after the block list changes, and read its status.
enum CallDirectorySync {
  enum Status: Equatable {
    case enabled, disabled, unknown
  }

  static var extensionIdentifier: String { ClickeyConfig.appBundleId + ".CallDirectory" }

  static func reload() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      CXCallDirectoryManager.sharedInstance.reloadExtension(withIdentifier: extensionIdentifier) { error in
        if let error { print("Call Directory reload failed: \(error.localizedDescription)") }
        continuation.resume()
      }
    }
  }

  static func status() async -> Status {
    await withCheckedContinuation { continuation in
      CXCallDirectoryManager.sharedInstance.getEnabledStatusForExtension(withIdentifier: extensionIdentifier) {
        status, _ in
        switch status {
        case .enabled: continuation.resume(returning: .enabled)
        case .disabled: continuation.resume(returning: .disabled)
        default: continuation.resume(returning: .unknown)
        }
      }
    }
  }

  /// Opens Settings › Phone › Call Blocking & Identification.
  static func openSettings() {
    CXCallDirectoryManager.sharedInstance.openSettings { error in
      if let error { print("Couldn't open call settings: \(error.localizedDescription)") }
    }
  }
}
