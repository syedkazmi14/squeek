import Foundation

// Screen Guard: a broadcast extension reads the text on the screen about every 30 seconds, entirely
// on the phone, and flags a likely scam. It can't make network requests worth relying on and has
// about 50 MB of memory, so it hands what it finds to the app through the App Group: one small file
// per alert, plus a heartbeat the app uses to tell whether the broadcast is running.
// Frames and the text read from them are never saved; an alert holds only a redacted excerpt.

public struct ScreenGuardAlert: Codable, Sendable, Identifiable, Equatable {
  public let id: String
  public let date: Date
  public let headline: String
  /// A short piece of the screen's text with private details removed, from the rule that matched.
  public let excerpt: String?
  public let reasons: [String]
  /// True when the extension already showed a notification, so the app doesn't repeat it.
  public var notified: Bool

  public init(id: String = UUID().uuidString.lowercased(), date: Date = Date(), headline: String, excerpt: String?, reasons: [String], notified: Bool) {
    self.id = id
    self.date = date
    self.headline = headline
    self.excerpt = excerpt
    self.reasons = reasons
    self.notified = notified
  }
}

/// Written by the extension each time it looks at the screen. Beyond "it's alive" it records what
/// the last look found, as a count and a verdict only, never the words, so the app can show whether
/// Screen Guard is really reading the screen.
public struct ScreenGuardStatus: Codable, Sendable, Equatable {
  public var startedAt: Date
  public var lastFrameAt: Date
  /// How many times it has looked since the broadcast started.
  public var looks: Int?
  /// How many characters the last look read.
  public var lastCharacters: Int?
  /// "clear", "caution", "danger", "own_screen", "little_text", "no_rules", "image_failed" or "no_text".
  public var lastResult: String?

  public init(startedAt: Date, lastFrameAt: Date, looks: Int? = nil, lastCharacters: Int? = nil, lastResult: String? = nil) {
    self.startedAt = startedAt
    self.lastFrameAt = lastFrameAt
    self.looks = looks
    self.lastCharacters = lastCharacters
    self.lastResult = lastResult
  }

  /// The extension looks every 30 seconds, so a beat in the last 90 means it's still running.
  public func isRunning(now: Date = Date()) -> Bool {
    now.timeIntervalSince(lastFrameAt) < ScreenGuardPolicy.runningWindow
  }
}

/// When to look at the screen and when to speak up. A class so the extension's frame callback and its
/// worker queue can share it.
public final class ScreenGuardPolicy: @unchecked Sendable {
  public static let interval: TimeInterval = 30
  public static let runningWindow: TimeInterval = 90
  /// The same screen doesn't alert again for this long.
  public static let sameScreenCooldown: TimeInterval = 10 * 60
  /// Whatever the screen, no more than one alert in this time.
  public static let anyAlertCooldown: TimeInterval = 60

  private let lock = NSLock()
  private var nextSample = Date.distantPast
  private var lastAlert = Date.distantPast
  private var alerted: [Int: Date] = [:]

  public init() {}

  /// True at most once per interval. ReplayKit delivers dozens of frames a second; this drops the rest.
  public func shouldSample(now: Date = Date()) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard now >= nextSample else { return false }
    nextSample = now.addingTimeInterval(Self.interval)
    return true
  }

  /// True if a likely scam on this screen (identified by `fingerprint`) should raise an alert now.
  public func shouldAlert(fingerprint: Int, now: Date = Date()) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard now.timeIntervalSince(lastAlert) >= Self.anyAlertCooldown else { return false }
    if let last = alerted[fingerprint], now.timeIntervalSince(last) < Self.sameScreenCooldown { return false }
    alerted[fingerprint] = now
    lastAlert = now
    alerted = alerted.filter { now.timeIntervalSince($0.value) < Self.sameScreenCooldown }
    return true
  }

  /// Squeek's own screens show warnings and example scam text; reading them back would raise an alert
  /// about the alert. The app name is on nearly all of them.
  public static func isOwnScreen(_ text: String) -> Bool {
    text.range(of: "squeek", options: .caseInsensitive) != nil
  }

  /// Too little text to judge (a photo, a home screen).
  public static func hasEnoughText(_ text: String) -> Bool {
    text.count >= 40
  }
}

extension SharedStore {
  private var screenGuardStatusURL: URL { containerURL.appendingPathComponent("screenguard-status.json") }
  private var screenGuardAlertsURL: URL { containerURL.appendingPathComponent("screenguard-alerts", isDirectory: true) }

  private static let screenGuardEncoder: JSONEncoder = {
    let e = JSONEncoder()
    e.dateEncodingStrategy = .iso8601
    return e
  }()
  private static let screenGuardDecoder: JSONDecoder = {
    let d = JSONDecoder()
    d.dateDecodingStrategy = .iso8601
    return d
  }()

  public func screenGuardStatus() -> ScreenGuardStatus? {
    guard let data = try? Data(contentsOf: screenGuardStatusURL) else { return nil }
    return try? Self.screenGuardDecoder.decode(ScreenGuardStatus.self, from: data)
  }

  public func saveScreenGuardStatus(_ status: ScreenGuardStatus) {
    try? Self.screenGuardEncoder.encode(status).write(to: screenGuardStatusURL, options: .atomic)
  }

  public func clearScreenGuardStatus() {
    try? FileManager.default.removeItem(at: screenGuardStatusURL)
  }

  /// One file per alert, so the extension adding one while the app collects others can't lose either.
  public func addScreenGuardAlert(_ alert: ScreenGuardAlert) {
    try? FileManager.default.createDirectory(at: screenGuardAlertsURL, withIntermediateDirectories: true)
    let url = screenGuardAlertsURL.appendingPathComponent("\(alert.id).json")
    try? Self.screenGuardEncoder.encode(alert).write(to: url, options: .atomic)
  }

  /// Returns the waiting alerts, oldest first, and deletes them.
  public func takeScreenGuardAlerts() -> [ScreenGuardAlert] {
    let urls = (try? FileManager.default.contentsOfDirectory(at: screenGuardAlertsURL, includingPropertiesForKeys: nil)) ?? []
    var alerts: [ScreenGuardAlert] = []
    for url in urls where url.pathExtension == "json" {
      if let data = try? Data(contentsOf: url), let alert = try? Self.screenGuardDecoder.decode(ScreenGuardAlert.self, from: data) {
        alerts.append(alert)
      }
      try? FileManager.default.removeItem(at: url)
    }
    return alerts.sorted { $0.date < $1.date }
  }
}
