import Foundation

// Swift mirror of packages/detection/src/engine.ts. Keep behavior identical;
// tests/fixtures/golden.json is checked against both.

public enum Risk: String, Codable, Sendable {
  case noDetectedSignal = "no_detected_signal"
  case caution
  case highRisk = "high_risk"
  case unknown
}

public struct SignalMatch: Sendable, Equatable {
  public let id: String
  public let category: String
  public let weight: Int
  public let label: String
  public let excerpt: String
}

public struct LocalAssessment: Sendable {
  public let risk: Risk
  public let score: Int
  public let categories: [String]
  public let matches: [SignalMatch]
}

public final class DetectionEngine: @unchecked Sendable {
  public let rules: RuleSet
  private let redactions: [(NSRegularExpression, String)]
  private let signals: [(RuleSet.SignalRule, [NSRegularExpression])]

  public init(rules: RuleSet) {
    self.rules = rules
    redactions = rules.redaction.compactMap { rule in
      (try? NSRegularExpression(pattern: rule.pattern, options: [.caseInsensitive])).map { ($0, rule.replacement) }
    }
    signals = rules.signals.map { signal in
      (signal, signal.patterns.compactMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) })
    }
  }

  public func redact(_ text: String) -> String {
    var out = text
    for (regex, template) in redactions {
      out = regex.stringByReplacingMatches(
        in: out, range: NSRange(out.startIndex..., in: out), withTemplate: template)
    }
    return out
  }

  public func findSignals(in redactedText: String) -> [SignalMatch] {
    let ns = redactedText as NSString
    var matches: [SignalMatch] = []
    for (signal, regexes) in signals {
      for regex in regexes {
        if let m = regex.firstMatch(in: redactedText, range: NSRange(location: 0, length: ns.length)) {
          matches.append(
            SignalMatch(
              id: signal.id, category: signal.category, weight: signal.weight, label: signal.label,
              excerpt: Self.excerpt(ns, range: m.range, radius: rules.policy.excerptRadius)))
          break
        }
      }
    }
    return matches
  }

  public func decideRisk(score: Int, categories: Set<String>) -> Risk {
    if score >= rules.policy.highRiskScore { return .highRisk }
    for combo in rules.policy.highRiskCombos where combo.allSatisfy(categories.contains) {
      return .highRisk
    }
    if score >= rules.policy.cautionScore { return .caution }
    return .noDetectedSignal
  }

  public func assessLocally(redactedText: String) -> LocalAssessment {
    let matches = findSignals(in: redactedText)
    let score = matches.reduce(0) { $0 + $1.weight }
    let categories = Set(matches.map(\.category))
    return LocalAssessment(
      risk: decideRisk(score: score, categories: categories), score: score,
      categories: categories.sorted(), matches: matches)
  }

  /// Headline and spoken sentence built only from the approved templates and reason labels.
  public func message(for key: String, reasonLabels: [String]) -> (headline: String, speech: String) {
    let template = rules.messages[key] ?? rules.messages["unknown"]
      ?? RuleSet.MessageTemplate(headline: "", speech: "")
    if reasonLabels.isEmpty || key == "no_detected_signal" || key == "link_no_signal" {
      return (template.headline, template.speech)
    }
    var seen = Set<String>()
    let labels = reasonLabels.filter { seen.insert($0).inserted }.prefix(3)
    return (template.headline, "\(template.speech) \(rules.reasonsPrefix) \(labels.joined(separator: "; ")).")
  }

  private static func excerpt(_ text: NSString, range: NSRange, radius: Int) -> String {
    let from = max(0, range.location - radius)
    let to = min(text.length, range.location + range.length + radius)
    var excerpt = text.substring(with: NSRange(location: from, length: to - from))
      .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
    if from > 0 { excerpt = "…" + excerpt }
    if to < text.length { excerpt += "…" }
    return excerpt
  }
}
