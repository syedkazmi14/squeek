import Foundation

// Files in the App Group container that the app writes and the extensions read.
// Extensions never write here, except the Share and Safari extensions saving the device id they were given.

public struct BlockedNumber: Codable, Sendable, Hashable {
  public let e164: String
  public let label: String?
  public let source: String  // "user" | "household" | "community" | "seed"

  public init(e164: String, label: String?, source: String) {
    self.e164 = e164
    self.label = label
    self.source = source
  }
}

public struct BlockedDomain: Codable, Sendable, Hashable {
  public let domain: String
  public let label: String?
  public let source: String

  public init(domain: String, label: String?, source: String) {
    self.domain = domain
    self.label = label
    self.source = source
  }
}

public struct BlockListSnapshot: Codable, Sendable {
  public var updatedAt: Date
  public var numbers: [BlockedNumber]
  public var domains: [BlockedDomain]
  /// When false, community and seed numbers are only labeled on the incoming-call screen, not blocked.
  public var blockReportedNumbers: Bool

  public init(updatedAt: Date = Date(), numbers: [BlockedNumber], domains: [BlockedDomain], blockReportedNumbers: Bool) {
    self.updatedAt = updatedAt
    self.numbers = numbers
    self.domains = domains
    self.blockReportedNumbers = blockReportedNumbers
  }

  public static let empty = BlockListSnapshot(updatedAt: .distantPast, numbers: [], domains: [], blockReportedNumbers: false)

  public init(entries: [BlockEntry], blockReportedNumbers: Bool) {
    var numbers: [String: BlockedNumber] = [:]
    var domains: [String: BlockedDomain] = [:]
    // Personal and household entries win over community/seed labels for the same value.
    let rank = ["user": 0, "household": 1, "community": 2, "seed": 3]
    for e in entries.sorted(by: { (rank[$0.source] ?? 9) < (rank[$1.source] ?? 9) }) {
      if e.kind == "phone", numbers[e.value] == nil {
        numbers[e.value] = BlockedNumber(e164: e.value, label: e.label, source: e.source)
      } else if e.kind == "domain", domains[e.value] == nil {
        domains[e.value] = BlockedDomain(domain: e.value, label: e.label, source: e.source)
      }
    }
    self.init(
      numbers: numbers.values.sorted { $0.e164 < $1.e164 },
      domains: domains.values.sorted { $0.domain < $1.domain },
      blockReportedNumbers: blockReportedNumbers)
  }
}

public struct SharedSettings: Codable, Sendable {
  public var signedIn: Bool
  public var muted: Bool
  public var voiceRate: Double
  public var historySync: Bool
  public var deviceId: String?

  public init(signedIn: Bool = false, muted: Bool = false, voiceRate: Double = 0.45, historySync: Bool = true, deviceId: String? = nil) {
    self.signedIn = signedIn
    self.muted = muted
    self.voiceRate = voiceRate
    self.historySync = historySync
    self.deviceId = deviceId
  }
}

public final class SharedStore: @unchecked Sendable {
  public let containerURL: URL

  public init?(appGroup: String) {
    guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
    containerURL = url
  }

  public init(directory: URL) { containerURL = directory }

  private var blockListURL: URL { containerURL.appendingPathComponent("blocklist.json") }
  private var settingsURL: URL { containerURL.appendingPathComponent("settings.json") }

  private static let encoder: JSONEncoder = {
    let e = JSONEncoder()
    e.dateEncodingStrategy = .iso8601
    return e
  }()
  private static let decoder: JSONDecoder = {
    let d = JSONDecoder()
    d.dateDecodingStrategy = .iso8601
    return d
  }()

  public func blockList() -> BlockListSnapshot {
    guard let data = try? Data(contentsOf: blockListURL),
      let s = try? Self.decoder.decode(BlockListSnapshot.self, from: data)
    else { return .empty }
    return s
  }

  public func save(_ snapshot: BlockListSnapshot) throws {
    try Self.encoder.encode(snapshot).write(to: blockListURL, options: .atomic)
  }

  public func settings() -> SharedSettings {
    guard let data = try? Data(contentsOf: settingsURL),
      let s = try? Self.decoder.decode(SharedSettings.self, from: data)
    else { return SharedSettings() }
    return s
  }

  public func save(_ settings: SharedSettings) throws {
    try Self.encoder.encode(settings).write(to: settingsURL, options: .atomic)
  }
}

/// What the Call Directory extension hands to CallKit. CallKit requires ascending, unique numbers,
/// and a number should not be both blocked and identified.
public enum CallDirectoryPlan {
  public struct Identification: Equatable, Sendable {
    public let number: Int64
    public let label: String
  }

  public static func make(_ snapshot: BlockListSnapshot) -> (blocking: [Int64], identification: [Identification]) {
    var blocking = Set<Int64>()
    var identification: [Int64: String] = [:]
    for n in snapshot.numbers {
      guard let number = PhoneNumbers.callKitNumber(fromE164: n.e164) else { continue }
      let personal = n.source == "user" || n.source == "household"
      if personal || snapshot.blockReportedNumbers {
        blocking.insert(number)
      } else {
        identification[number] = label(for: n)
      }
    }
    for number in blocking { identification.removeValue(forKey: number) }
    return (
      blocking.sorted(),
      identification.keys.sorted().map { Identification(number: $0, label: identification[$0]!) }
    )
  }

  public static func label(for n: BlockedNumber) -> String {
    switch n.source {
    case "seed": return "Squeek: reported scam"
    case "community": return "Squeek: reported by others"
    default: return "Squeek: blocked"
    }
  }
}
