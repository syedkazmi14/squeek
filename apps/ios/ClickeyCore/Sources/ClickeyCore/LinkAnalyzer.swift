import Foundation

// Swift mirror of packages/detection/src/links.ts (offline heuristics only).

public enum LinkVerdict: String, Codable, Sendable {
  case malicious, suspicious
  case noSignal = "no_signal"
  case unknown
}

public struct LinkFinding: Sendable, Equatable {
  public let id: String
  public let label: String
  public let weight: Int
}

public struct LinkAnalysis: Sendable {
  public let input: String
  public let url: String?
  public let host: String?
  public let domain: String?
  public let score: Int
  public let verdict: LinkVerdict
  public let findings: [LinkFinding]
}

public struct LinkAnalyzer: Sendable {
  public let rules: RuleSet

  public init(rules: RuleSet) { self.rules = rules }

  private static let schemePrefix = try! NSRegularExpression(pattern: "^[a-z][a-z0-9+.-]*:", options: [.caseInsensitive])
  private static let ipv4 = try! NSRegularExpression(pattern: "^\\d{1,3}(\\.\\d{1,3}){3}$")
  private static let urlInText = try! NSRegularExpression(
    pattern: "\\b((?:https?://|www\\.)[^\\s<>\"')\\]]+|[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.[a-z]{2,}/[^\\s<>\"')\\]]*)",
    options: [.caseInsensitive])

  private static func matches(_ regex: NSRegularExpression, _ s: String) -> Bool {
    regex.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
  }

  public static func extractURLs(from text: String, limit: Int = 5) -> [String] {
    var found: [String] = []
    for m in urlInText.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
      guard let r = Range(m.range, in: text) else { continue }
      var candidate = String(text[r])
      while let last = candidate.last, ".,;:!?".contains(last) { candidate.removeLast() }
      if !found.contains(candidate) { found.append(candidate) }
      if found.count >= limit { break }
    }
    return found
  }

  public static func normalize(_ input: String) -> URLComponents? {
    var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !s.isEmpty else { return nil }
    if !matches(schemePrefix, s) { s = "https://" + s }
    let components =
      URLComponents(string: s)
      ?? URL(string: s, encodingInvalidCharacters: true).flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
    guard let c = components, let scheme = c.scheme?.lowercased(), scheme == "http" || scheme == "https",
      let host = c.host, !host.isEmpty
    else { return nil }
    return c
  }

  public func registrableDomain(_ host: String) -> String {
    var h = host.lowercased()
    if h.hasSuffix(".") { h.removeLast() }
    if Self.matches(Self.ipv4, h) || h.contains(":") { return h }
    let labels = h.split(separator: ".").map(String.init)
    if labels.count <= 2 { return h }
    let lastTwo = labels.suffix(2).joined(separator: ".")
    if rules.links.secondLevelSuffixes.contains(lastTwo) { return labels.suffix(3).joined(separator: ".") }
    return lastTwo
  }

  public static func host(_ host: String, matchesDomain domain: String) -> Bool {
    let h = host.lowercased()
    let d = domain.lowercased()
    return h == d || h.hasSuffix("." + d)
  }

  public static func isBlocked(host: String, blockedDomains: [String]) -> Bool {
    blockedDomains.contains { Self.host(host, matchesDomain: $0) }
  }

  public func analyze(_ input: String, blockedDomains: [String] = []) -> LinkAnalysis {
    guard let c = Self.normalize(input), let rawHost = c.host else {
      return LinkAnalysis(input: input, url: nil, host: nil, domain: nil, score: 0, verdict: .unknown, findings: [])
    }
    let host = rawHost.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
    let domain = registrableDomain(host)
    var findings: [LinkFinding] = []
    func add(_ id: String, _ label: String, _ weight: Int) { findings.append(LinkFinding(id: id, label: label, weight: weight)) }

    if Self.isBlocked(host: host, blockedDomains: blockedDomains) {
      add("blocked_domain", "This website is on your Clickey block list", 10)
    }
    if c.scheme?.lowercased() == "http" { add("not_https", "Not a secure (https) link", 1) }
    if Self.matches(Self.ipv4, host) || host.contains(":") {
      add("ip_host", "Goes to a number address instead of a website name", 3)
    }
    let labels = host.split(separator: ".").map(String.init)
    if labels.contains(where: { $0.hasPrefix("xn--") }) || host.unicodeScalars.contains(where: { !$0.isASCII }) {
      add("punycode", "Uses look-alike letters in the address", 3)
    }
    let withoutScheme = input.replacingOccurrences(of: "^[a-z]+://", with: "", options: [.regularExpression, .caseInsensitive])
    let authority = withoutScheme.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
    if c.user != nil || c.password != nil || authority.contains("@") {
      add("at_sign", "Hides the real address behind an @ sign", 3)
    }
    if rules.links.shorteners.contains(domain) { add("shortener", "Shortened link hides where it goes", 1) }
    let tld = domain.split(separator: ".").last.map(String.init) ?? ""
    if rules.links.suspiciousTlds.contains(tld) { add("suspicious_tld", "Uses an address ending often used by scams", 2) }
    if labels.count >= 5 { add("many_subdomains", "Unusually long website address", 1) }
    if input.count > 200 { add("long_url", "Very long link", 1) }

    let tokens = host.split(whereSeparator: { $0 == "." || $0 == "-" }).map(String.init)
    let official = rules.links.brands.values.contains { $0.contains { Self.host(host, matchesDomain: $0) } }
    if !official {
      // Sorted so the reported brand is deterministic (the TypeScript side iterates JSON order).
      for brand in rules.links.brands.keys.sorted() {
        let short = brand.count <= rules.links.shortBrandMaxLength
        let hit = short ? tokens.contains(brand) : tokens.contains { $0.contains(brand) }
        if hit {
          add("brand_mismatch", "Uses the name \"\(brand)\" but isn't that company's website", 3)
          break
        }
      }
      if tokens.contains(where: { t in rules.links.lureWords.contains { t.contains($0) } }) {
        add("lure_words", "Address uses words like \"verify\" or \"login\"", 1)
      }
    }

    let score = findings.reduce(0) { $0 + $1.weight }
    let verdict: LinkVerdict =
      findings.contains { $0.id == "blocked_domain" } ? .malicious : score >= 3 ? .suspicious : .noSignal
    return LinkAnalysis(
      input: input, url: c.url?.absoluteString, host: host, domain: domain, score: score, verdict: verdict,
      findings: findings)
  }
}
