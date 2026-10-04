import Foundation

/// Build settings passed through each target's Info.plist (see Config/Squeek.xcconfig).
/// In an extension, `Bundle.main` is the extension's own bundle, which carries the same keys.
enum SqueekConfig {
  private static func value(_ key: String) -> String {
    (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
  }

  /// xcconfig files treat `//` as a comment, so only the host is configured and the scheme is added here.
  static var supabaseURL: URL? {
    let host = value("SqueekSupabaseHost")
    guard !host.isEmpty, !host.contains("your-project") else { return nil }
    return URL(string: host.hasPrefix("http") ? host : "https://\(host)")
  }

  static var supabaseAnonKey: String { value("SqueekSupabaseAnonKey") }
  static var appGroup: String { value("SqueekAppGroup") }
  static var keychainGroup: String { value("SqueekKeychainGroup") }
  /// Bundle id of the containing app, also used for extension identifiers.
  static var appBundleId: String { value("SqueekAppBundleId") }

  /// Configuration profile that turns on Cloudflare's malware-blocking encrypted DNS for the
  /// whole phone (served by supabase/functions/dns-profile). Opened in Safari to install.
  static var dnsProfileURL: URL? {
    supabaseURL?.appendingPathComponent("functions/v1/dns-profile")
  }

  static var isBackendConfigured: Bool { supabaseURL != nil && !supabaseAnonKey.isEmpty }

  static var appVersion: String {
    (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0"
  }
}
