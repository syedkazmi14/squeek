import Foundation
import NetworkExtension

/// System-wide encrypted DNS through Cloudflare's malware-blocking resolver, so known dangerous
/// sites fail to load in every app. Needs the Network Extension "DNS Settings" capability; after
/// installing, the person turns it on in Settings › General › VPN & Device Management › DNS.
enum ProtectiveDNS {
  static let servers = ["1.1.1.2", "1.0.0.2", "2606:4700:4700::1112", "2606:4700:4700::1002"]
  static let serverURL = URL(string: "https://security.cloudflare-dns.com/dns-query")!

  static func isInstalled() async -> Bool {
    let manager = NEDNSSettingsManager.shared()
    do {
      try await manager.loadFromPreferences()
      return manager.dnsSettings != nil
    } catch {
      return false
    }
  }

  static func isEnabled() async -> Bool {
    let manager = NEDNSSettingsManager.shared()
    do {
      try await manager.loadFromPreferences()
      return manager.dnsSettings != nil && manager.isEnabled
    } catch {
      return false
    }
  }

  static func install() async throws {
    let manager = NEDNSSettingsManager.shared()
    try await manager.loadFromPreferences()
    let settings = NEDNSOverHTTPSSettings(servers: servers)
    settings.serverURL = serverURL
    manager.dnsSettings = settings
    manager.localizedDescription = "Clickey protective DNS"
    try await manager.saveToPreferences()
  }

  static func remove() async throws {
    let manager = NEDNSSettingsManager.shared()
    try await manager.loadFromPreferences()
    try await manager.removeFromPreferences()
  }
}
