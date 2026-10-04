import AppIntents
import SqueekCore

/// For a Shortcuts automation that runs when a text arrives (Automation › Message). It checks the
/// message on the phone first, and sends only texts with a link or a warning sign for a closer
/// check, so ordinary chat stays private and the daily check limit lasts. A likely scam is recorded
/// (it shows in Activity and counts toward the payment pause) and announced with a notification.
/// Ordinary texts stay quiet.
struct ScreenMessageIntent: AppIntent {
  static let title: LocalizedStringResource = "Screen a Message"
  static let description = IntentDescription(
    "Run this when you get a text. Squeek checks it for scam signs and tells you if it looks like one.")
  static let supportedModes: IntentModes = .background

  @Parameter(title: "Message", description: "The text that arrived. Choose Shortcut Input.")
  var message: String

  @MainActor
  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    let text = String(message.prefix(4000))
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return .result(value: "") }

    let service = CheckService.shared
    // On the phone first. Nothing leaves it unless the text has a link or already looks off.
    let local = service.localText(text)
    let hasLink = !(local.links ?? []).isEmpty
    let result = local.level == .clear && !hasLink ? local : await service.checkText(text, surface: .sms)

    // Let the payment pause see a warning recorded just now, even if the app was asleep.
    await AppModel.shared.loadRecentIncidents()

    switch result.level {
    case .danger:
      Notifications.post(title: "This text looks like a scam", body: "Squeek: \(result.headline). Don't reply or tap any links.")
    case .caution:
      Notifications.post(title: "Be careful with this text", body: "Squeek: \(result.headline). Check with someone you trust first.")
    case .clear, .unknown:
      break
    }
    return .result(value: result.level.rawValue)
  }
}
