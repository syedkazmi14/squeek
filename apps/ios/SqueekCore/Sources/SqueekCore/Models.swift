import Foundation

// Data shapes shared with Supabase. Database rows use snake_case keys (explicit CodingKeys);
// Edge Function payloads use camelCase (see supabase/functions/_shared/types.ts).
// Timestamps are kept as strings so PostgREST and Realtime payloads decode the same way.

public enum Surface: String, Codable, Sendable, CaseIterable {
  case email, sms, call, link, share, screenshot, browser, text
}

// MARK: - Edge Function payloads

public struct AssessRequest: Encodable, Sendable {
  public let text: String
  public let surface: Surface
  public let platform: String
  public let deviceId: String?

  public init(text: String, surface: Surface, deviceId: String?) {
    self.text = text
    self.surface = surface
    self.platform = "ios"
    self.deviceId = deviceId
  }
}

public struct LinkCheckRequest: Encodable, Sendable {
  public let url: String
  public let surface: Surface
  public let platform: String
  public let deviceId: String?

  public init(url: String, surface: Surface, deviceId: String?) {
    self.url = url
    self.surface = surface
    self.platform = "ios"
    self.deviceId = deviceId
  }
}

public struct ReportRequest: Encodable, Sendable {
  public let kind: String  // "phone" | "domain"
  public let value: String
  public let label: String?
  public let householdId: String?
  public let deviceId: String?

  public init(kind: String, value: String, label: String?, householdId: String?, deviceId: String?) {
    self.kind = kind
    self.value = value
    self.label = label
    self.householdId = householdId
    self.deviceId = deviceId
  }
}

public struct ReportResponse: Decodable, Sendable {
  public let kind: String
  public let value: String
  public let incidentId: String?
}

public struct PairClaimRequest: Encodable, Sendable {
  public let action = "claim"
  public let code: String
  public init(code: String) { self.code = code }
}

public struct PairClaimResponse: Decodable, Sendable {
  public let ok: Bool
}

public enum Level: String, Codable, Sendable {
  case danger, caution, clear, unknown

  public init(risk: Risk) {
    switch risk {
    case .highRisk: self = .danger
    case .caution: self = .caution
    case .noDetectedSignal: self = .clear
    case .unknown: self = .unknown
    }
  }

  public init(verdict: LinkVerdict) {
    switch verdict {
    case .malicious: self = .danger
    case .suspicious: self = .caution
    case .noSignal: self = .clear
    case .unknown: self = .unknown
    }
  }

  public var severity: Int {
    switch self {
    case .danger: return 3
    case .caution: return 2
    case .unknown: return 1
    case .clear: return 0
    }
  }
}

public struct Reason: Codable, Sendable, Hashable {
  public let id: String
  public let label: String
  public let excerpt: String?
  /// The exact matched text, used to highlight the phrase in the original message.
  public let match: String?
  public let source: String  // "rule" | "ai" | "link" | "blocklist"

  public init(id: String, label: String, excerpt: String? = nil, match: String? = nil, source: String) {
    self.id = id
    self.label = label
    self.excerpt = excerpt
    self.match = match
    self.source = source
  }
}

public struct LinkSummary: Codable, Sendable, Hashable {
  public let url: String
  public let domain: String?
  public let verdict: LinkVerdict
  public let reasons: [Reason]
}

public struct CheckStatus: Codable, Sendable, Hashable {
  /// "used" | "unavailable" | "disabled"
  public let ai: String?
  /// "match" | "no_match" | "unavailable" | "disabled"
  public let safeBrowsing: String?
  /// "expanded" | "not_needed" | "failed"
  public let redirects: String?

  public init(ai: String? = nil, safeBrowsing: String? = nil, redirects: String? = nil) {
    self.ai = ai
    self.safeBrowsing = safeBrowsing
    self.redirects = redirects
  }
}

/// Result of checking a message or a link, from the server or from local rules.
public struct CheckResult: Codable, Sendable, Identifiable {
  public var id = UUID()
  public let kind: String  // "text" | "link"
  public let level: Level
  public let headline: String
  public let speech: String
  public let reasons: [Reason]
  public let links: [LinkSummary]?
  public let checks: CheckStatus?
  public let incidentId: String?
  public let rulesVersion: String?
  public let url: String?
  public let finalUrl: String?
  public let domain: String?
  /// True when produced on this device only (offline, signed out, or before the server answers).
  public var isLocal: Bool

  private enum CodingKeys: String, CodingKey {
    case kind, level, headline, speech, reasons, links, checks, incidentId, rulesVersion, url, finalUrl, domain, isLocal
  }

  public init(
    kind: String, level: Level, headline: String, speech: String, reasons: [Reason], links: [LinkSummary]? = nil,
    checks: CheckStatus? = nil, incidentId: String? = nil, rulesVersion: String? = nil, url: String? = nil,
    finalUrl: String? = nil, domain: String? = nil, isLocal: Bool
  ) {
    self.kind = kind
    self.level = level
    self.headline = headline
    self.speech = speech
    self.reasons = reasons
    self.links = links
    self.checks = checks
    self.incidentId = incidentId
    self.rulesVersion = rulesVersion
    self.url = url
    self.finalUrl = finalUrl
    self.domain = domain
    self.isLocal = isLocal
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    kind = try c.decode(String.self, forKey: .kind)
    level = try c.decode(Level.self, forKey: .level)
    headline = try c.decode(String.self, forKey: .headline)
    speech = try c.decode(String.self, forKey: .speech)
    reasons = try c.decodeIfPresent([Reason].self, forKey: .reasons) ?? []
    links = try c.decodeIfPresent([LinkSummary].self, forKey: .links)
    checks = try c.decodeIfPresent(CheckStatus.self, forKey: .checks)
    incidentId = try c.decodeIfPresent(String.self, forKey: .incidentId)
    rulesVersion = try c.decodeIfPresent(String.self, forKey: .rulesVersion)
    url = try c.decodeIfPresent(String.self, forKey: .url)
    finalUrl = try c.decodeIfPresent(String.self, forKey: .finalUrl)
    domain = try c.decodeIfPresent(String.self, forKey: .domain)
    isLocal = try c.decodeIfPresent(Bool.self, forKey: .isLocal) ?? false
  }
}

// MARK: - Database rows

public struct Profile: Codable, Sendable, Equatable {
  public let id: String
  public var displayName: String?
  public var voiceRate: Double
  public var textScale: Double
  public var muted: Bool
  public var historySync: Bool
  public var shareIncidentsWithHelpers: Bool
  public var blockReportedNumbers: Bool
  /// Where Squeek calls the person to say what it found on a screened call (E.164).
  public var alertPhone: String?

  enum CodingKeys: String, CodingKey {
    case id
    case displayName = "display_name"
    case voiceRate = "voice_rate"
    case textScale = "text_scale"
    case muted
    case historySync = "history_sync"
    case shareIncidentsWithHelpers = "share_incidents_with_helpers"
    case blockReportedNumbers = "block_reported_numbers"
    case alertPhone = "alert_phone"
  }
}

/// Fields the app may change on its own profile row.
public struct ProfileUpdate: Encodable, Sendable {
  public let displayName: String?
  public let voiceRate: Double
  public let textScale: Double
  public let muted: Bool
  public let historySync: Bool
  public let shareIncidentsWithHelpers: Bool
  public let blockReportedNumbers: Bool
  public let alertPhone: String?

  public init(_ p: Profile) {
    displayName = p.displayName
    voiceRate = p.voiceRate
    textScale = p.textScale
    muted = p.muted
    historySync = p.historySync
    shareIncidentsWithHelpers = p.shareIncidentsWithHelpers
    blockReportedNumbers = p.blockReportedNumbers
    alertPhone = p.alertPhone
  }

  enum CodingKeys: String, CodingKey {
    case displayName = "display_name"
    case voiceRate = "voice_rate"
    case textScale = "text_scale"
    case muted
    case historySync = "history_sync"
    case shareIncidentsWithHelpers = "share_incidents_with_helpers"
    case blockReportedNumbers = "block_reported_numbers"
    case alertPhone = "alert_phone"
  }

  // Written out so a removed number is sent as null rather than left out.
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(displayName, forKey: .displayName)
    try c.encode(voiceRate, forKey: .voiceRate)
    try c.encode(textScale, forKey: .textScale)
    try c.encode(muted, forKey: .muted)
    try c.encode(historySync, forKey: .historySync)
    try c.encode(shareIncidentsWithHelpers, forKey: .shareIncidentsWithHelpers)
    try c.encode(blockReportedNumbers, forKey: .blockReportedNumbers)
    try c.encode(alertPhone, forKey: .alertPhone)
  }
}

public struct Incident: Codable, Sendable, Identifiable, Equatable {
  public let id: String
  public let userId: String
  public let deviceId: String?
  public let platform: String
  public let surface: String
  public let risk: String
  public let categories: [String]
  public let ruleIds: [String]?
  public let evidenceRedacted: String?
  public let indicatorKind: String?
  public let indicatorValue: String?
  public var userAction: String?
  public let createdAt: String

  enum CodingKeys: String, CodingKey {
    case id
    case userId = "user_id"
    case deviceId = "device_id"
    case platform, surface, risk, categories
    case ruleIds = "rule_ids"
    case evidenceRedacted = "evidence_redacted"
    case indicatorKind = "indicator_kind"
    case indicatorValue = "indicator_value"
    case userAction = "user_action"
    case createdAt = "created_at"
  }

  /// "clear" is a genuine caller Squeek took a message from.
  public var level: Level { risk == "clear" ? .clear : Level(risk: Risk(rawValue: risk) ?? .unknown) }
  public var date: Date? { Timestamps.parse(createdAt) }
  /// Written by Squeek's call screener on the server rather than by one of the person's devices.
  public var isScreenedCall: Bool { surface == "call" && deviceId == nil }
  /// A caller who said the secret word and was put through to the person (call-webhook writes "Trusted caller").
  public var isTrustedCaller: Bool { isScreenedCall && risk == "clear" && (evidenceRedacted ?? "").hasPrefix("Trusted caller") }
}

/// A call Squeek's phone agent answered (supabase/functions/call-webhook). No audio or transcript:
/// just who the caller said they were, what they wanted, and the verdict.
public struct ScreenedCall: Codable, Sendable, Identifiable, Equatable {
  public let id: String
  public let userId: String
  public let callerE164: String?
  public let durationSecs: Int?
  public let risk: String
  public let categories: [String]
  public let callerClaims: String?
  public let callerWants: String?
  public let callbackE164: String?
  /// "matched", "wrong", "not_given" or "not_set"; nil unless the caller said they were family.
  public let safeWord: String?
  public let incidentId: String?
  public let createdAt: String

  enum CodingKeys: String, CodingKey {
    case id
    case userId = "user_id"
    case callerE164 = "caller_e164"
    case durationSecs = "duration_secs"
    case risk, categories
    case callerClaims = "caller_claims"
    case callerWants = "caller_wants"
    case callbackE164 = "callback_e164"
    case safeWord = "safe_word"
    case incidentId = "incident_id"
    case createdAt = "created_at"
  }
}

public struct BlockEntry: Codable, Sendable, Identifiable, Hashable {
  public let entryId: String?
  public let kind: String  // "phone" | "domain"
  public let value: String
  public let label: String?
  public let source: String  // "user" | "household" | "community" | "seed"
  public let householdId: String?

  public var id: String { "\(kind):\(source):\(value)" }

  public init(entryId: String?, kind: String, value: String, label: String?, source: String, householdId: String?) {
    self.entryId = entryId
    self.kind = kind
    self.value = value
    self.label = label
    self.source = source
    self.householdId = householdId
  }

  enum CodingKeys: String, CodingKey {
    case entryId = "entry_id"
    case kind, value, label, source
    case householdId = "household_id"
  }
}

public struct NewBlockedNumber: Encodable, Sendable {
  public let ownerUserId: String?
  public let householdId: String?
  public let e164: String
  public let label: String?
  public let source: String
  public let createdBy: String

  public init(ownerUserId: String?, householdId: String?, e164: String, label: String?, createdBy: String) {
    self.ownerUserId = ownerUserId
    self.householdId = householdId
    self.e164 = e164
    self.label = label
    self.source = householdId == nil ? "user" : "household"
    self.createdBy = createdBy
  }

  enum CodingKeys: String, CodingKey {
    case ownerUserId = "owner_user_id"
    case householdId = "household_id"
    case e164, label, source
    case createdBy = "created_by"
  }
}

public struct NewBlockedDomain: Encodable, Sendable {
  public let ownerUserId: String?
  public let householdId: String?
  public let domain: String
  public let label: String?
  public let source: String
  public let createdBy: String

  public init(ownerUserId: String?, householdId: String?, domain: String, label: String?, createdBy: String) {
    self.ownerUserId = ownerUserId
    self.householdId = householdId
    self.domain = domain
    self.label = label
    self.source = householdId == nil ? "user" : "household"
    self.createdBy = createdBy
  }

  enum CodingKeys: String, CodingKey {
    case ownerUserId = "owner_user_id"
    case householdId = "household_id"
    case domain, label, source
    case createdBy = "created_by"
  }
}

public struct Device: Codable, Sendable, Identifiable {
  public let id: String
  public let userId: String
  public let platform: String
  public let name: String?
  public let appVersion: String?
  public let monitoringStatus: String?
  public let lastSeenAt: String?

  enum CodingKeys: String, CodingKey {
    case id
    case userId = "user_id"
    case platform, name
    case appVersion = "app_version"
    case monitoringStatus = "monitoring_status"
    case lastSeenAt = "last_seen_at"
  }
}

public struct DeviceUpsert: Encodable, Sendable {
  public let id: String
  public let userId: String
  public let platform: String
  public let name: String
  public let appVersion: String
  public let monitoringStatus: String
  public let lastSeenAt: String

  public init(id: String, userId: String, name: String, appVersion: String, monitoringStatus: String) {
    self.id = id
    self.userId = userId
    self.platform = "ios"
    self.name = name
    self.appVersion = appVersion
    self.monitoringStatus = monitoringStatus
    self.lastSeenAt = Timestamps.format(Date())
  }

  enum CodingKeys: String, CodingKey {
    case id
    case userId = "user_id"
    case platform, name
    case appVersion = "app_version"
    case monitoringStatus = "monitoring_status"
    case lastSeenAt = "last_seen_at"
  }
}

public struct HouseholdMember: Codable, Sendable, Identifiable, Hashable {
  public let householdId: String
  public let householdName: String
  public let userId: String
  public let role: String  // "protected" | "helper"
  public let displayName: String?
  public let isMe: Bool

  public var id: String { householdId + userId }

  enum CodingKeys: String, CodingKey {
    case householdId = "household_id"
    case householdName = "household_name"
    case userId = "user_id"
    case role
    case displayName = "display_name"
    case isMe = "is_me"
  }
}

/// A helper asking someone they look out for "are you OK?". Open for a day, then it lapses.
public struct CheckIn: Codable, Sendable, Identifiable, Equatable {
  public let id: String
  public let protectedUserId: String
  public let helperId: String
  public var status: String  // "asked" | "ok" | "call_me"
  public let createdAt: String
  public var answeredAt: String?

  public static let lifetime: TimeInterval = 24 * 3600

  enum CodingKeys: String, CodingKey {
    case id
    case protectedUserId = "protected_user_id"
    case helperId = "helper_id"
    case status
    case createdAt = "created_at"
    case answeredAt = "answered_at"
  }

  public init(id: String, protectedUserId: String, helperId: String, status: String, createdAt: Date, answeredAt: Date? = nil) {
    self.id = id
    self.protectedUserId = protectedUserId
    self.helperId = helperId
    self.status = status
    self.createdAt = Timestamps.format(createdAt)
    self.answeredAt = answeredAt.map(Timestamps.format)
  }

  public var date: Date? { Timestamps.parse(createdAt) }
  public var answerDate: Date? { answeredAt.flatMap(Timestamps.parse) }

  /// Waiting for an answer, and not yet a day old.
  public func isOpen(now: Date = Date()) -> Bool {
    status == "asked" && (date ?? .distantPast) > now.addingTimeInterval(-Self.lifetime)
  }
}

public struct HelperDevice: Codable, Sendable, Identifiable, Hashable {
  public let userId: String
  public let displayName: String?
  public let platform: String
  public let name: String?
  public let monitoringStatus: String?
  public let lastSeenAt: String?

  public var id: String { userId + platform + (name ?? "") }

  enum CodingKeys: String, CodingKey {
    case userId = "user_id"
    case displayName = "display_name"
    case platform, name
    case monitoringStatus = "monitoring_status"
    case lastSeenAt = "last_seen_at"
  }
}

public enum Timestamps {
  private static let withFraction: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()
  private static let plain = ISO8601DateFormatter()

  /// Parses Postgres timestamps such as "2026-10-03T18:14:00.123456+00:00".
  public static func parse(_ s: String) -> Date? {
    if let d = withFraction.date(from: s) ?? plain.date(from: s) { return d }
    // Trim microseconds to milliseconds, which ISO8601DateFormatter accepts.
    let trimmed = s.replacingOccurrences(of: "(\\.\\d{3})\\d+", with: "$1", options: .regularExpression)
      .replacingOccurrences(of: " ", with: "T")
    return withFraction.date(from: trimmed) ?? plain.date(from: trimmed)
  }

  public static func format(_ d: Date) -> String { withFraction.string(from: d) }
}
