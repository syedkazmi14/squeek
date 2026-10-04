import Foundation

/// On-device checks used when the server can't be reached, before it answers, and inside
/// extensions that have no network access (the SMS filter). Mirrors the server's combination
/// of message rules and link findings in supabase/functions/assess-text.
public final class LocalChecker: @unchecked Sendable {
  public let engine: DetectionEngine
  public let links: LinkAnalyzer

  /// A suspicious link adds this much to the message score, under the "link" category.
  public static let suspiciousLinkWeight = 2

  public init(rules: RuleSet) {
    engine = DetectionEngine(rules: rules)
    links = LinkAnalyzer(rules: rules)
  }

  public func redact(_ text: String) -> String { engine.redact(text) }

  public func checkText(_ text: String, blockedDomains: [String] = []) -> CheckResult {
    let redacted = engine.redact(String(text.prefix(8000)))
    let local = engine.assessLocally(redactedText: redacted)
    var score = local.score
    var categories = Set(local.categories)
    var reasons = local.matches.map { Reason(id: $0.id, label: $0.label, excerpt: $0.excerpt, match: $0.match, source: "rule") }

    var linkSummaries: [LinkSummary] = []
    var hasMaliciousLink = false
    for raw in LinkAnalyzer.extractURLs(from: redacted) {
      let a = links.analyze(raw, blockedDomains: blockedDomains)
      guard a.url != nil else { continue }
      let linkReasons = a.findings.map { Reason(id: $0.id, label: $0.label, source: "link") }
      linkSummaries.append(LinkSummary(url: a.url ?? raw, domain: a.domain, verdict: a.verdict, reasons: linkReasons))
      switch a.verdict {
      case .malicious:
        hasMaliciousLink = true
        reasons.append(Reason(id: "link_blocked", label: "Contains a link on your block list", excerpt: a.domain, source: "blocklist"))
      case .suspicious:
        score += Self.suspiciousLinkWeight
        categories.insert("link")
        reasons.append(Reason(id: "link_suspicious", label: "Contains a suspicious link", excerpt: a.domain, source: "link"))
      default:
        break
      }
    }

    let risk = hasMaliciousLink ? .highRisk : engine.decideRisk(score: score, categories: categories)
    let message = engine.message(for: risk.rawValue, reasonLabels: reasons.map(\.label))
    return CheckResult(
      kind: "text", level: Level(risk: risk), headline: message.headline, speech: message.speech, reasons: reasons,
      links: linkSummaries, checks: CheckStatus(ai: "disabled"), rulesVersion: engine.rules.version, isLocal: true)
  }

  public func checkLink(_ url: String, blockedDomains: [String] = []) -> CheckResult {
    let a = links.analyze(url, blockedDomains: blockedDomains)
    let key: String
    switch a.verdict {
    case .malicious: key = "link_malicious"
    case .suspicious: key = "link_suspicious"
    case .noSignal: key = "link_no_signal"
    case .unknown: key = "link_unknown"
    }
    let reasons = a.findings.map { Reason(id: $0.id, label: $0.label, source: $0.id == "blocked_domain" ? "blocklist" : "link") }
    let message = engine.message(for: key, reasonLabels: reasons.map(\.label))
    return CheckResult(
      kind: "link", level: Level(verdict: a.verdict), headline: message.headline, speech: message.speech,
      reasons: reasons, checks: CheckStatus(safeBrowsing: "disabled", redirects: "not_needed"),
      rulesVersion: engine.rules.version, url: a.url ?? url, domain: a.domain, isLocal: true)
  }
}
