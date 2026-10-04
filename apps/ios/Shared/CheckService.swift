import SqueekCore
import Foundation

/// Runs a check on the server when signed in, falling back to on-device rules.
/// A fallback that finds nothing is reported as "couldn't fully check", never as clear.
final class CheckService: @unchecked Sendable {
  static let shared = CheckService()

  let store: SharedStore?
  let checker: LocalChecker?

  private init() {
    store = SharedStore(appGroup: SqueekConfig.appGroup)
    checker = RuleSet.bundled().map(LocalChecker.init(rules:))
  }

  var blockedDomains: [String] { store?.blockList().domains.map(\.domain) ?? [] }
  var deviceId: String? { store?.settings().deviceId }

  func localText(_ text: String) -> CheckResult {
    checker?.checkText(text, blockedDomains: blockedDomains) ?? Self.unavailable(kind: "text")
  }

  func localLink(_ url: String) -> CheckResult {
    checker?.checkLink(url, blockedDomains: blockedDomains) ?? Self.unavailable(kind: "link")
  }

  func checkText(_ text: String, surface: Surface) async -> CheckResult {
    let local = localText(text)
    guard Backend.shared.isSignedIn else { return degrade(local, reason: nil) }
    do {
      // Redact on the device before anything leaves it; the server redacts again.
      let redacted = checker?.redact(text) ?? text
      var result = try await Backend.shared.assess(text: redacted, surface: surface, deviceId: deviceId)
      // A local block-list hit always wins, even if the server disagrees.
      if local.level == .danger && result.level != .danger { result = local }
      return await recordIfMissing(result, surface: surface)
    } catch {
      return await recordIfMissing(degrade(local, reason: error.localizedDescription), surface: surface)
    }
  }

  func checkLink(_ url: String, surface: Surface) async -> CheckResult {
    let local = localLink(url)
    guard Backend.shared.isSignedIn else { return degrade(local, reason: nil) }
    do {
      var result = try await Backend.shared.checkLink(url, surface: surface, deviceId: deviceId)
      if local.level == .danger && result.level != .danger { result = local }
      return await recordIfMissing(result, surface: surface)
    } catch {
      return await recordIfMissing(degrade(local, reason: error.localizedDescription), surface: surface)
    }
  }

  /// A likely scam the phone found by itself has no incident on the server. Record one so it shows
  /// in Activity and counts toward the payment pause, if the person keeps a history.
  private func recordIfMissing(_ result: CheckResult, surface: Surface) async -> CheckResult {
    guard result.level == .danger, result.incidentId == nil, store?.settings().historySync == true else { return result }
    await Backend.shared.recordLocalIncident(surface: surface, domain: result.kind == "link" ? result.domain : nil, deviceId: deviceId)
    return result
  }

  /// Local-only results that found nothing become "unknown": local rules are only part of the check.
  private func degrade(_ local: CheckResult, reason: String?) -> CheckResult {
    guard local.level == .clear, let checker else { return local }
    let key = local.kind == "link" ? "link_unknown" : "unknown"
    let message = checker.engine.message(for: key, reasonLabels: [])
    var reasons = local.reasons
    if let reason {
      reasons.append(Reason(id: "server_unavailable", label: "Full check unavailable: \(reason)", source: "rule"))
    }
    return CheckResult(
      kind: local.kind, level: .unknown, headline: message.headline, speech: message.speech, reasons: reasons,
      links: local.links, checks: CheckStatus(ai: "unavailable", safeBrowsing: "unavailable"),
      rulesVersion: local.rulesVersion, url: local.url, domain: local.domain, isLocal: true)
  }

  private static func unavailable(kind: String) -> CheckResult {
    CheckResult(
      kind: kind, level: .unknown, headline: "Couldn't check this", speech: "I couldn't check this. Please be careful.",
      reasons: [], isLocal: true)
  }
}
