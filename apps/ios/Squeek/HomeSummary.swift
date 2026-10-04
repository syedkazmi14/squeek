import Foundation
import SqueekCore

/// What Squeek says on Home: a greeting, then what happened since the person was last in the app.
/// Written from templates on the phone, so it's instant, private and never makes things up.
struct HomeSummary {
  enum Action {
    /// A warning nobody has looked at yet.
    case review(Incident)
    /// Some guards are still off.
    case finishSetup
    /// A trusted person is asking if I'm OK.
    case answerCheckIn(CheckIn)
    /// A person I help asked me to call them.
    case call(name: String, phone: String?)
  }

  let greeting: String
  let message: String
  let mood: MascotView.Mood
  let action: Action?

  /// The words read aloud by the speaker button.
  var spoken: String { "\(greeting) \(message)" }

  init(
    name: String?, incidents: [Incident], myUserId: String?, since: Date, guardsOff: Int, guardsTotal: Int,
    checkIns: [CheckIn] = [], phoneOf: (String) -> String? = { _ in nil },
    memberName: (String) -> String?, now: Date = Date()
  ) {
    let hour = Calendar.current.component(.hour, from: now)
    let partOfDay = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
    greeting = name.map { "\(partOfDay), \($0)." } ?? "\(partOfDay)."

    let isMine: (Incident) -> Bool = { $0.userId == myUserId }
    let recent = incidents.filter { ($0.date ?? .distantPast) > since }
    let counts = Self.countSentence(recent.filter(isMine))
    let family = Self.familySentence(recent.filter { !isMine($0) }, memberName: memberName)

    // Someone who looks out for me is asking if I'm OK: answering comes before anything else.
    if let ask = checkIns.filter({ $0.protectedUserId == myUserId && $0.isOpen(now: now) })
      .max(by: { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) })
    {
      let helper = memberName(ask.helperId) ?? "Someone who looks out for you"
      mood = .calm
      action = .answerCheckIn(ask)
      message = "\(helper) is checking in on you. Are you OK?"
      return
    }

    // A person I help asked me to call: that's the one thing to do.
    let answers = checkIns.filter { $0.helperId == myUserId && $0.status != "asked" && ($0.answerDate ?? .distantPast) > now.addingTimeInterval(-CheckIn.lifetime) }
    if let callMe = answers.filter({ $0.status == "call_me" }).max(by: { ($0.answerDate ?? .distantPast) < ($1.answerDate ?? .distantPast) }) {
      let who = memberName(callMe.protectedUserId) ?? "Someone you help"
      mood = .concerned
      action = .call(name: who, phone: phoneOf(callMe.protectedUserId))
      message = "\(who) asked you to call them. They answered when you checked in."
      return
    }

    // An unreviewed likely scam from the last few days comes first, even if it's from before the last visit.
    let lately = now.addingTimeInterval(-3 * 24 * 3600)
    if let urgent = incidents.first(where: {
      $0.level == .danger && $0.userAction == nil && ($0.date ?? .distantPast) > lately
    }) {
      mood = .concerned
      action = .review(urgent)
      let lead = isMine(urgent) ? Self.lead(for: urgent) : Self.familyLead(for: urgent, memberName: memberName)
      message = [lead, "Tap below to see what I found."].joined(separator: " ")
      return
    }

    mood = .calm
    var parts: [String] = []
    if let counts {
      // The reassurance only fits when there's no setup nudge after it.
      parts.append("Since you were last here, I \(counts).\(guardsOff == 0 ? " Everything else looked fine." : "")")
    } else {
      parts.append(
        guardsOff == guardsTotal ? "Nothing to report yet." : "Nothing suspicious since you were last here. I'm still keeping watch.")
    }
    if let family { parts.append(family) }
    let fine = answers.filter { $0.status == "ok" }.compactMap { memberName($0.protectedUserId) }
    if !fine.isEmpty { parts.append("\(Self.list(Array(Set(fine)).sorted())) said they're OK.") }
    if guardsOff > 0 {
      let which = ["One of my guards is", "Two of my guards are", "Three of my guards are", "Four of my guards are"]
      parts.append(
        guardsOff < guardsTotal && guardsOff <= which.count
          ? "\(which[guardsOff - 1]) off, so I can't watch everything yet."
          : "My guards are all off, so I can't watch for scams yet.")
      action = .finishSetup
    } else {
      action = nil
    }
    message = parts.joined(separator: " ")
  }

  // MARK: Sentences

  /// "flagged 2 suspicious calls and caught 1 scam text", or nil when nothing happened.
  private static func countSentence(_ incidents: [Incident]) -> String? {
    var answered = 0, calls = 0, texts = 0, sites = 0, computer = 0, other = 0
    for incident in incidents {
      if incident.platform == "windows" {
        computer += 1
        continue
      }
      if incident.isScreenedCall {
        answered += 1
        continue
      }
      switch incident.surface {
      case "call": calls += 1
      case "sms": texts += 1
      case "link", "browser": sites += 1
      default: other += 1
      }
    }
    let phrases = [
      answered > 0 ? "answered \(plural(answered, "call")) for you" : nil,
      calls > 0 ? "flagged \(plural(calls, "suspicious call"))" : nil,
      texts > 0 ? "caught \(plural(texts, "scam text"))" : nil,
      sites > 0 ? "flagged \(plural(sites, "risky website"))" : nil,
      computer > 0 ? "warned you about \(plural(computer, "thing")) on your computer" : nil,
      other > 0 ? "spotted \(plural(other, "other warning sign"))" : nil,
    ].compactMap { $0 }
    return phrases.isEmpty ? nil : list(phrases)
  }

  /// For helpers: "Aisha got 1 warning, so you might want to check in."
  private static func familySentence(_ incidents: [Incident], memberName: (String) -> String?) -> String? {
    guard !incidents.isEmpty else { return nil }
    var order: [String] = []
    var counts: [String: Int] = [:]
    for incident in incidents {
      let name = memberName(incident.userId) ?? "Someone you help"
      if counts[name] == nil { order.append(name) }
      counts[name, default: 0] += 1
    }
    let phrases = order.map { "\($0) got \(plural(counts[$0] ?? 0, "warning"))" }
    return "\(list(phrases)), so you might want to check in."
  }

  private static func lead(for incident: Incident) -> String {
    if incident.platform == "windows" { return "Your computer spotted something that looks like a scam." }
    switch incident.surface {
    case "call": return incident.isScreenedCall ? "I answered a call that looked like a scam." : "A call came in that looked like a scam."
    case "sms": return "A text came in that looked like a scam."
    case "link", "browser": return "I stopped a website that looked dangerous."
    default: return "Something you got looks like a scam."
    }
  }

  private static func familyLead(for incident: Incident, memberName: (String) -> String?) -> String {
    let name = memberName(incident.userId) ?? "Someone you help"
    return "\(name) got something that looks like a scam. You might want to check in."
  }

  private static func plural(_ n: Int, _ noun: String) -> String {
    n == 1 ? "1 \(noun)" : "\(n) \(noun)s"
  }

  /// "a", "a and b", "a, b and c".
  private static func list(_ items: [String]) -> String {
    guard items.count > 1 else { return items.first ?? "" }
    return items.dropLast().joined(separator: ", ") + " and " + items.last!
  }
}
