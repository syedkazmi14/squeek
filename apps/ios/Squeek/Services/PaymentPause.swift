import Foundation
import SqueekCore

/// A pause before paying: a likely scam reached this person in the last half hour, and now they're
/// opening a payment or bank app. Scammers rush people to pay while they're still rattled, so
/// Squeek steps in with what happened and someone to call. See PaymentPauseView.
struct PaymentPause: Identifiable {
  let incident: Incident
  /// From the setup screen's "Try the pause": nothing is recorded.
  var isPractice = false

  var id: String { incident.id }

  /// What happened, in one or two sentences.
  var whatHappened: String {
    let when = incident.date.map { Self.ago($0) } ?? "a few minutes ago"
    if incident.isScreenedCall {
      let parts = (incident.evidenceRedacted ?? "").components(separatedBy: " · ")
      var text = "Squeek answered a call \(when) that looked like a scam."
      if let claims = parts.first, !claims.isEmpty { text += " They said they were \(claims)" }
      if parts.count > 1 { text += ", and wanted \(parts[1])." } else if parts.first?.isEmpty == false { text += "." }
      return text
    }
    let source = incident.platform == "windows" ? "on your computer" : "on this iPhone"
    if incident.level == .caution {
      return "Squeek noticed something \(source) \(when) that may be a scam (\(Labels.surface(incident.surface).lowercased()))."
    }
    return "Squeek warned you about a likely scam \(source) \(when) (\(Labels.surface(incident.surface).lowercased()))."
  }

  /// Why it matters right now.
  var why: String {
    "Scammers often get in touch just before they ask for money, and push you to hurry. Anyone genuine will wait while you check."
  }

  /// One line for the Lock Screen and Dynamic Island.
  var liveActivityText: String {
    incident.isScreenedCall
      ? "Squeek answered a scam call. Pause before you pay anyone."
      : incident.level == .caution
        ? "Squeek noticed something that may be a scam. Pause before you pay anyone."
        : "Squeek caught a likely scam. Pause before you pay anyone."
  }

  /// Read aloud when the pause opens.
  var spoken: String {
    "Hold on. \(whatHappened) Take a moment before you pay anyone."
  }

  private static func ago(_ date: Date) -> String {
    let minutes = max(1, Int(Date().timeIntervalSince(date) / 60))
    return minutes == 1 ? "a minute ago" : "\(minutes) minutes ago"
  }

  /// A made-up scam call for "Try the pause" when there's no real one.
  static var practice: PaymentPause {
    let json = """
      {"id":"practice","user_id":"me","device_id":null,"platform":"ios","surface":"call","risk":"high_risk",
       "categories":["impersonation","payment"],"rule_ids":[],"evidence_redacted":"Mike, the grandson · gift cards to pay bail",
       "indicator_kind":null,"indicator_value":null,"user_action":null,
       "created_at":"\(Timestamps.format(Date().addingTimeInterval(-4 * 60)))"}
      """
    let incident = try! JSONDecoder().decode(Incident.self, from: Data(json.utf8))
    return PaymentPause(incident: incident, isPractice: true)
  }
}
