import AppIntents

/// For a Shortcuts automation that runs when a payment or bank app opens. If Squeek caught a likely
/// scam in the last half hour, it brings Squeek forward with the payment pause; otherwise it finishes
/// quietly and the person carries on.
struct CheckBeforePayingIntent: AppIntent {
  static let title: LocalizedStringResource = "Check Before Paying"
  static let description = IntentDescription(
    "Run this when you open a payment or bank app. If Squeek caught a likely scam in the last half hour, it opens Squeek so you can pause first. Otherwise it does nothing.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @MainActor
  func perform() async throws -> some IntentResult {
    let model = AppModel.shared
    await model.loadRecentIncidentsIfNeeded()
    guard let risk = model.recentRisk() else { return .result() }
    model.pause = PaymentPause(incident: risk)
    try await continueInForeground(nil, alwaysConfirm: false)
    return .result()
  }
}

struct SqueekShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: CheckBeforePayingIntent(),
      phrases: ["Check before paying with \(.applicationName)"],
      shortTitle: "Check before paying",
      systemImageName: "hand.raised.fill")
  }
}
