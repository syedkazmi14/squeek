import Foundation

/// Decoded form of packages/rules/rules/rules.json. The same file drives the TypeScript engine.
public struct RuleSet: Decodable, Sendable {
  public struct RedactionRule: Decodable, Sendable {
    public let id: String
    public let pattern: String
    public let replacement: String
  }

  public struct SignalRule: Decodable, Sendable {
    public let id: String
    public let category: String
    public let weight: Int
    public let label: String
    public let patterns: [String]
  }

  public struct Policy: Decodable, Sendable {
    public let cautionScore: Int
    public let highRiskScore: Int
    public let highRiskCombos: [[String]]
    public let excerptRadius: Int
  }

  public struct Links: Decodable, Sendable {
    public let shorteners: [String]
    public let suspiciousTlds: [String]
    public let secondLevelSuffixes: [String]
    public let lureWords: [String]
    public let brands: [String: [String]]
    public let shortBrandMaxLength: Int
  }

  public struct MessageTemplate: Decodable, Sendable {
    public let headline: String
    public let speech: String
    public let detail: String?

    public init(headline: String, speech: String, detail: String?) {
      self.headline = headline
      self.speech = speech
      self.detail = detail
    }
  }

  public let version: String
  public let redaction: [RedactionRule]
  public let signals: [SignalRule]
  public let policy: Policy
  public let links: Links
  public let messages: [String: MessageTemplate]
  public let reasonsPrefix: String

  private enum CodingKeys: String, CodingKey {
    case version, redaction, signals, policy, links, messages
  }

  private struct AnyKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    version = try c.decode(String.self, forKey: .version)
    redaction = try c.decode([RedactionRule].self, forKey: .redaction)
    signals = try c.decode([SignalRule].self, forKey: .signals)
    policy = try c.decode(Policy.self, forKey: .policy)
    links = try c.decode(Links.self, forKey: .links)
    // `messages` mixes templates with the plain `reasons_prefix` string.
    let m = try c.nestedContainer(keyedBy: AnyKey.self, forKey: .messages)
    var templates: [String: MessageTemplate] = [:]
    var prefix = "Warning signs:"
    for key in m.allKeys {
      if key.stringValue == "reasons_prefix" {
        prefix = try m.decode(String.self, forKey: key)
      } else {
        templates[key.stringValue] = try m.decode(MessageTemplate.self, forKey: key)
      }
    }
    messages = templates
    reasonsPrefix = prefix
  }

  public static func load(from url: URL) throws -> RuleSet {
    try JSONDecoder().decode(RuleSet.self, from: Data(contentsOf: url))
  }

  /// Loads `rules.json` copied into a target's bundle by the Xcode project.
  public static func bundled(in bundle: Bundle = .main) -> RuleSet? {
    guard let url = bundle.url(forResource: "rules", withExtension: "json") else { return nil }
    return try? load(from: url)
  }
}
