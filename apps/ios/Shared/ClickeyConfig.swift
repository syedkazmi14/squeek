import Foundation

/// Build settings passed through each target's Info.plist (see Config/Clickey.xcconfig).
/// In an extension, `Bundle.main` is the extension's own bundle, which carries the same keys.
enum ClickeyConfig {
  private static func value(_ key: String) -> String {
    (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
  }

  /// xcconfig files treat `//` as a comment, so only the host is configured and the scheme is added here.
  static var supabaseURL: URL? {
    let host = value("ClickeySupabaseHost")
    guard !host.isEmpty, !host.contains("your-project") else { return nil }
    return URL(string: host.hasPrefix("http") ? host : "https://\(host)")
  }

  static var supabaseAnonKey: String { value("ClickeySupabaseAnonKey") }
  static var appGroup: String { value("ClickeyAppGroup") }
  static var keychainGroup: String { value("ClickeyKeychainGroup") }
  /// Bundle id of the containing app, also used for extension identifiers.
  static var appBundleId: String { value("ClickeyAppBundleId") }

  /// Push, Sign in with Apple and protective DNS need a paid Apple Developer Program account.
  static var hasPaidAccount: Bool { value("ClickeyAccount").lowercased() == "paid" }

  static var isBackendConfigured: Bool { supabaseURL != nil && !supabaseAnonKey.isEmpty }

  static var appVersion: String {
    (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0"
  }
}
